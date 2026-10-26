/**
 * Arma src/lib/guia-manual/equivalencias.json: que codigos de Cermaq,
 * Multiexport y Yadran son el mismo producto, para las opciones de precio de
 * la guia manual. Siempre dentro de la misma familia (CC con CC...) y con a
 * lo mas un codigo por empresa en cada grupo. Dos fuentes:
 * 1. El buscador de precios: productos que se costean con la misma compra y
 *    el mismo factor (mismo formato de venta), solo vinculos confirmados.
 * 2. Nombre estricto: mismas palabras y mismo tamano, sin unidades ni envases.
 *
 *   npm run script scripts/generar-equivalencias.mts vinculos.json
 * (vinculos.json sale de scripts/exportar-vinculos-buscador.mjs)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
const buscador: { compra: string; estado: string[]; codigos: Record<string, { nombre: string; factor: number }> }[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { data } = await getSupabaseServiceClient().from("productos_catalogo").select("sku, nombre_relbase, descripcion, familia").eq("activo", true).range(0, 1999);
const ps = (data ?? []).filter((p) => /^(CERQ|MTX|YDR)_[A-Z]+_\d+$/.test(p.sku)).map((p) => ({ sku: p.sku, emp: p.sku.split("_")[0], fam: p.sku.split("_")[1], nombre: p.nombre_relbase ?? p.descripcion ?? "" }));
const vigente = new Map(ps.map((p) => [p.sku, p]));
const IGN = new Set("de del la el los las y o en para al x un und unid unidad uni kg kgs kilo kilos gr grs g gramo lt lts litro l ml cc pqte paquete pack bot botella saco pote frasco bolsa bol lata sobre pet nac nacional tpk tarro bidon caja bandeja tubo malla atado mata pedir".split(" "));
// Tamano normalizado ("240 g", "1,6 l" -> 1600ml); "1 kg", "kg" y "1 lt" son la unidad de venta y no cuentan.
const clave = (n: string) => {
  let t = n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\bc\//g, "con ").replace(/\bs\//g, "sin ").replace(/(\d),(\d)/g, "$1.$2");
  t = t.replace(/(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grs?|g|gramos?|lts?|litros?|l|ml|cc)\b/g, (_m, num, u) => {
    const v = Number(num);
    const esPeso = /^(kgs?|kilos?|grs?|g|gramos?)$/.test(u);
    const base = /^(kgs?|kilos?|lts?|litros?|l)$/.test(u) ? v * 1000 : v;
    return base === 1000 ? " " : ` ${base}${esPeso ? "g" : "ml"} `;
  });
  return t.replace(/(?<!\d)\.|\.(?!\d)/g, " ").replace(/[^a-z0-9.]+/g, " ").split(" ")
    .filter((w) => w && !IGN.has(w) && !/^\d+$/.test(w))
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .sort().join(" ");
};
// union-find
const padre = new Map<string, string>(); const raiz = (x: string): string => { const p = padre.get(x) ?? x; if (p === x) return x; const r = raiz(p); padre.set(x, r); return r; };
const miembros = new Map<string, string[]>(); const de = (r: string) => miembros.get(r) ?? [r];
const emp = (c: string) => c.split("_")[0];
let conflictos = 0;
/** Une solo si el grupo resultante sigue teniendo un codigo por empresa. */
const unir = (a: string, b: string) => {
  const ra = raiz(a), rb = raiz(b); if (ra === rb) return true;
  const ea = new Set(de(ra).map(emp)); if (de(rb).some((c) => ea.has(emp(c)))) { conflictos++; return false; }
  padre.set(rb, ra); miembros.set(ra, [...de(ra), ...de(rb)]); return true;
};
const origen = new Map<string, Set<string>>(); const marca = (a: string, b: string, o: string) => { for (const x of [a, b]) (origen.get(x) ?? origen.set(x, new Set()).get(x)!).add(o); };

// 1) buscador: misma compra + mismo factor + misma familia, solo confirmados
for (const g of buscador) {
  if (!g.estado.includes("confirmado")) continue;
  const porFactor = new Map<number, string[]>();
  for (const [c, v] of Object.entries(g.codigos)) if (vigente.has(c)) porFactor.set(v.factor, [...(porFactor.get(v.factor) ?? []), c]);
  for (const cs of porFactor.values()) { const emps = new Set(cs.map((c) => c.split("_")[0])); if (emps.size < 2) continue; for (const c of cs.slice(1)) if (unir(cs[0], c)) { marca(cs[0], c, "buscador"); } }
}
// 2) nombre estricto dentro de la familia, salvo que el buscador diga que el formato es otro
// (el "CALDO VACUNO 12 un Pqte." de Cermaq son 12 cubos, no uno: factor 30 vs 360).
const factorDe = new Map<string, number>();
for (const g of buscador) if (g.estado.includes("confirmado")) for (const [c, v] of Object.entries(g.codigos)) factorDe.set(c, v.factor);
const otroFormato = (a: string, b: string) => factorDe.has(a) && factorDe.has(b) && factorDe.get(a) !== factorDe.get(b);
const porClave = new Map<string, string[]>();
for (const p of ps) { const k = `${p.fam}|${clave(p.nombre)}`; porClave.set(k, [...(porClave.get(k) ?? []), p.sku]); }
for (const cs of porClave.values()) { const emps = new Set(cs.map((c) => c.split("_")[0])); if (emps.size < 2) continue; for (const c of cs.slice(1)) if (!otroFormato(cs[0], c) && unir(cs[0], c)) { marca(cs[0], c, "nombre"); } }
const grupos = new Map<string, string[]>(); for (const p of ps) { const r = raiz(p.sku); grupos.set(r, [...(grupos.get(r) ?? []), p.sku]); }
const reales = [...grupos.values()].filter((g) => new Set(g.map((c) => c.split("_")[0])).size >= 2);
const repetidos = reales.filter((g) => g.length !== new Set(g.map((c) => c.split("_")[0])).size);
const conEquiv = new Set(reales.flat());
for (const fam of ["AB", "CC", "FV", "AS"]) { const t = ps.filter((p) => p.fam === fam); console.log(fam, `con equivalente: ${t.filter((p) => conEquiv.has(p.sku)).length}/${t.length}`); }
console.log(`uniones rechazadas por repetir empresa: ${conflictos}`);
console.log(`grupos: ${reales.length} · en las 3 empresas: ${reales.filter((g) => new Set(g.map((c) => c.split("_")[0])).size === 3).length} · con 2+ códigos de una misma empresa: ${repetidos.length}`);
writeFileSync("src/lib/guia-manual/equivalencias.json", JSON.stringify(reales.map((g) => g.sort()).sort((a, b) => a[0].localeCompare(b[0])), null, 0).replace(/\],/g, "],\n") + "\n");
