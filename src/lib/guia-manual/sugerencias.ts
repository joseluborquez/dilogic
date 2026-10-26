/**
 * Sugerencias al escribir en la guia manual: los productos cuyo codigo o
 * nombre contienen todas las palabras escritas, con el mismo producto de las
 * tres empresas juntado en una sola sugerencia que muestra el MAS CARO (lo
 * que se cobra a un cliente externo). Sin dependencias de servidor.
 */
import { equivalentesDe, NOMBRE_EMPRESA, type ProductoGuia } from "./resolver";
import mismoProducto from "@/lib/ventas/mismo-producto.json";

// Mismo producto entre empresas (tabla de Ventas): solo los del mismo formato
// se comparan por precio; una bandeja de 30 no compite con un huevo suelto.
const MISMO = mismoProducto as unknown as Record<string, [string, number]>;
const POR_REFERENCIA = new Map<string, string[]>();
for (const [codigo, [ref]] of Object.entries(MISMO)) POR_REFERENCIA.set(ref, [...(POR_REFERENCIA.get(ref) ?? []), codigo]);

/** Equivalencias guardadas: las de la guia manual y las de mismo formato de Ventas. */
export function equivalentesGuardados(codigo: string): string[] {
  const propio = MISMO[codigo];
  const delMismoFormato = propio ? (POR_REFERENCIA.get(propio[0]) ?? []).filter((c) => MISMO[c][1] === propio[1]) : [];
  return [...new Set([...equivalentesDe(codigo), ...delMismoFormato])];
}

export interface Sugerencia {
  /** El de mayor precio del grupo: el que se propone. */
  producto: ProductoGuia;
  /** El mismo producto en las otras empresas (sin el propuesto), del mas caro al mas barato. */
  otros: ProductoGuia[];
}

const normalizar = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const precio = (p: ProductoGuia) => p.precio ?? -1;

/**
 * `grupos`: codigo -> codigos del mismo producto y formato (agruparMismoProducto);
 * cada palabra escrita debe ser el comienzo de una palabra del codigo o nombre.
 */
export function sugerirProductos(
  texto: string,
  productos: ProductoGuia[],
  porCodigo: Map<string, ProductoGuia>,
  grupos: Map<string, string[]>,
  limite = 12
): Sugerencia[] {
  const palabras = normalizar(texto).split(" ").filter(Boolean);
  if (palabras.length === 0) return [];

  const vistos = new Set<string>();
  const sugerencias: (Sugerencia & { orden: number })[] = [];
  for (const p of productos) {
    const tokens = normalizar(`${p.codigo.replace(/_/g, " ")} ${p.codigo} ${p.nombre}`).split(" ");
    if (!palabras.every((w) => tokens.some((t) => t.startsWith(w)))) continue;
    const grupo = (grupos.get(p.codigo) ?? [p.codigo])
      .map((c) => porCodigo.get(c))
      .filter((x): x is ProductoGuia => x != null);
    const clave = grupo.map((x) => x.codigo).sort().join("|") || p.codigo;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const ordenados = (grupo.length > 0 ? grupo : [p]).sort((a, b) => precio(b) - precio(a));
    const nombre = normalizar(p.nombre);
    // Primero los que empiezan con lo escrito; despues los nombres mas cortos (mas precisos).
    const orden = (nombre.startsWith(palabras[0]) ? 0 : 1000) + nombre.length;
    sugerencias.push({ producto: ordenados[0], otros: ordenados.slice(1), orden });
  }
  return sugerencias
    .sort((a, b) => a.orden - b.orden)
    .slice(0, limite)
    .map(({ producto, otros }) => ({ producto, otros }));
}

/** "el más caro de 3 · Yadran $9.985 · Multiexport $8.249" */
export function detalleSugerencia(s: Sugerencia, pesos: (n: number) => string): string {
  if (s.otros.length === 0) return "";
  const resto = s.otros.map((o) => `${NOMBRE_EMPRESA[o.empresa ?? ""] ?? o.codigo} ${o.precio != null ? pesos(o.precio) : "sin precio"}`);
  return `el más caro de ${s.otros.length + 1} · ${resto.join(" · ")}`;
}
