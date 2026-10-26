/**
 * Arma src/lib/ventas/mismo-producto.json: que codigos de Cermaq, Multiexport
 * y Yadran son el MISMO producto aunque se vendan en otro formato, y cuanto
 * vale cada uno en la unidad del de referencia. Ej.: la bandeja de huevos de
 * Cermaq (CERQ_AB_175) = 30 huevos sueltos de Multiexport (MTX_AB_099).
 * Lo usa la pagina de Ventas para sumar entre empresas sin mezclar formatos.
 *
 * Fuentes:
 * 1. equivalencias.json de la guia manual (mismo nombre y tamano).
 * 2. El buscador: codigos confirmados que se costean con la misma compra,
 *    con a lo mas un codigo por empresa (una compra generica como "verduras"
 *    junta muchos productos distintos y no sirve), salvo EXCLUIR.
 * El factor del buscador manda: si dos codigos de un grupo tienen factores
 * distintos, se convierten (el paquete de 12 caldos de Cermaq = 12 cubos).
 *
 *   npm run script scripts/generar-mismo-producto.mts factores.json
 * (factores.json sale de scripts/exportar-factores-buscador.mjs)
 */
import { readFileSync, writeFileSync } from "node:fs";
import equivalencias from "../src/lib/guia-manual/equivalencias.json";

interface FilaFactor {
  codigo: string;
  nombre: string;
  estado: string;
  provider_id: string;
  compra: string;
  factor: string;
}

// Misma compra en el buscador pero distinto producto para el cliente
// (revisado a mano el 26-oct-2026): Coca-Cola no es "bebidas surtidas".
const EXCLUIR = new Set(["CERQ_AB_112", "CERQ_AB_113", "MTX_AB_027", "MTX_AB_028"]);

// Codigos que cubren dos productos ("POSTA ROSADA Ó NEGRA"): no se sabe cual
// se vendio, asi que no se suman a ninguno y quedan en su propia fila.
const AMBIGUOS = new Set(["YDR_AB_088", "YDR_CC_007", "YDR_CC_022", "YDR_CC_036"]);

const filas: FilaFactor[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const f of filas) if (/\s[oó]\s/i.test(f.nombre)) AMBIGUOS.add(f.codigo);
const confirmados = new Map(filas.filter((f) => f.estado === "confirmado").map((f) => [f.codigo, f]));
const factor = (c: string) => (confirmados.has(c) ? Number(confirmados.get(c)!.factor) : null);
const empresa = (c: string) => c.split("_")[0];

// union-find
const padre = new Map<string, string>();
const raiz = (x: string): string => {
  const p = padre.get(x) ?? x;
  if (p === x) return x;
  const r = raiz(p);
  padre.set(x, r);
  return r;
};
const unir = (a: string, b: string) => {
  for (const x of [a, b]) if (!padre.has(x)) padre.set(x, x);
  padre.set(raiz(b), raiz(a));
};
// Codigos sin factor propio heredan el de un equivalente de mismo formato.
const mismoFormato = new Map<string, string[]>();

for (const grupo of equivalencias as string[][]) {
  const g = grupo.filter((c) => !AMBIGUOS.has(c));
  for (const c of g.slice(1)) unir(g[0], c);
  for (const c of g) mismoFormato.set(c, g);
}

const porCompra = new Map<string, string[]>();
for (const f of confirmados.values()) {
  if (EXCLUIR.has(f.codigo) || AMBIGUOS.has(f.codigo)) continue;
  const k = `${f.provider_id}|${f.compra}`;
  porCompra.set(k, [...(porCompra.get(k) ?? []), f.codigo]);
}
let agregados = 0;
for (const cs of porCompra.values()) {
  if (cs.length < 2 || new Set(cs.map(empresa)).size !== cs.length) continue;
  for (const c of cs.slice(1)) {
    if (raiz(c) !== raiz(cs[0])) agregados += 1;
    unir(cs[0], c);
  }
}

const grupos = new Map<string, string[]>();
for (const c of padre.keys()) grupos.set(raiz(c), [...(grupos.get(raiz(c)) ?? []), c]);

const salida: Record<string, [string, number]> = {};
let conversiones = 0;
for (const g of grupos.values()) {
  if (g.length < 2) continue;
  const f = new Map<string, number>();
  for (const c of g) {
    const propio = factor(c) ?? (mismoFormato.get(c) ?? []).map(factor).find((x) => x != null) ?? null;
    if (propio != null) f.set(c, propio);
  }
  // Sin factores (o todos iguales): mismo formato, 1 a 1.
  const conFactor = g.every((c) => f.has(c));
  if (!conFactor && f.size > 0 && new Set(f.values()).size > 1) {
    console.warn("grupo con factores incompletos, se deja 1 a 1:", g.join(" "));
  }
  const usar = conFactor ? f : new Map(g.map((c) => [c, 1]));
  // Referencia: el formato mas chico (mayor factor); a igualdad, el primero por codigo.
  const ref = [...g].sort((a, b) => usar.get(b)! - usar.get(a)! || a.localeCompare(b))[0];
  for (const c of g.sort()) {
    const rel = Math.round((usar.get(ref)! / usar.get(c)!) * 1000) / 1000;
    if (rel !== 1) conversiones += 1;
    salida[c] = [ref, rel];
  }
}

writeFileSync("src/lib/ventas/mismo-producto.json", JSON.stringify(salida, null, 0).replace(/\],/g, "],\n") + "\n");
console.log(`${Object.keys(salida).length} codigos en ${[...grupos.values()].filter((g) => g.length > 1).length} grupos; ${agregados} uniones nuevas desde el buscador; ${conversiones} codigos con conversion de formato`);
