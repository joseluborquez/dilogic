/**
 * Nombres de centro (contacto de la guia) escritos de varias formas en Relbase:
 * "CHALACAYEC" / "CHCLACAYEC", "BZA. DON ROBERTO" / "BARCAZA DON ROBERTO",
 * "CHURRECUE BASE" / "BASE CHURRECUE". Se juntan para que cada centro sume
 * en un solo lugar; el nombre que se muestra es el mas usado.
 */

const ABREVIATURAS: [RegExp, string][] = [
  [/^BZA /, "BARCAZA "],
  [/^P /, "PUNTA "],
  [/^OF /, "OFICINA "],
];

/** Clave sin tildes, signos ni espacios dobles, con abreviaturas expandidas. */
function clave(nombre: string): string {
  let t = nombre
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  for (const [re, por] of ABREVIATURAS) t = t.replace(re, por);
  // "BARCAZA DONA VIVI" es "DONA VIVI"; "CHURRECUE BASE" es "BASE CHURRECUE".
  t = t.replace(/^BARCAZA /, "");
  if (/ BASE$/.test(t)) t = `BASE ${t.replace(/ BASE$/, "")}`;
  return t;
}

const numeros = (t: string) => (t.match(/\d+/g) ?? []).join(",");

/** Distancia de edicion <= 1 (una letra cambiada, sobrante o faltante). */
function unaLetra(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length < b.length ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i);
}

/**
 * Nombre original -> nombre con que se muestra. Mismo centro si la clave es
 * igual o difiere en una letra (claves de 6+ letras y los mismos numeros:
 * MELCHOR 716 y MELCHOR 717 siguen separados).
 */
export function unificarCentros(nombres: { nombre: string; guias: number }[]): Map<string, string> {
  const grupos: { claves: string[]; miembros: { nombre: string; guias: number }[] }[] = [];
  for (const n of nombres) {
    const k = clave(n.nombre);
    const grupo = grupos.find((g) =>
      g.claves.some((c) => c === k || (k.length >= 6 && c.length >= 6 && numeros(c) === numeros(k) && unaLetra(c, k)))
    );
    if (grupo) {
      grupo.miembros.push(n);
      if (!grupo.claves.includes(k)) grupo.claves.push(k);
    } else grupos.push({ claves: [k], miembros: [n] });
  }
  const salida = new Map<string, string>();
  for (const g of grupos) {
    const principal = [...g.miembros].sort((a, b) => b.guias - a.guias)[0].nombre;
    for (const m of g.miembros) salida.set(m.nombre, principal);
  }
  return salida;
}

// --- Lista oficial de centros (tabla public.centros), compartida con el buscador de productos (17-11-2026) ---

/**
 * centro = venta en su centro; otros = venta en «Otros» de la empresa; bins y fuera = no son venta; traspaso = se
 * factura (cuenta en el total) pero no son productos propios ni dejan ganancia (Palvitad, Hugo 17-11-2026).
 */
export type TipoCentro = "centro" | "otros" | "bins" | "fuera" | "traspaso";
export interface CentroOficial {
  centro: string;
  tipo: TipoCentro;
}

/** Contacto normalizado como en la tabla centros: mayusculas, sin tildes ni signos, espacios simples. */
export const claveContacto = (s: string) =>
  s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

/** "MELCHOR 716" -> "Melchor 716", para un contacto que aun no esta en la lista oficial. */
export const nombreBonito = (t: string) =>
  t.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s.(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/**
 * Centro de una guia segun la lista oficial. Regla para un contacto que no esta (Hugo, 17-11-2026): si dice BINS es
 * bins; si difiere en una letra de uno de la lista (mismos numeros, 6+ letras) va a ese centro; si no, es un centro
 * nuevo con su propio nombre (cuenta como venta y queda «por revisar»). Igual que lib/guias.ts del buscador.
 */
export function resolverCentros(filas: { customer_id: number; contacto: string; centro: string; tipo: TipoCentro }[]) {
  const porCliente = new Map<number, Map<string, CentroOficial>>();
  for (const f of filas) {
    const m = porCliente.get(Number(f.customer_id)) ?? new Map<string, CentroOficial>();
    m.set(f.contacto, { centro: f.centro, tipo: f.tipo });
    porCliente.set(Number(f.customer_id), m);
  }
  return (customerId: number | null, contacto: string | null): CentroOficial & { nuevo: boolean } => {
    const k = contacto ? claveContacto(contacto) : "";
    if (!k) return { centro: "Sin centro", tipo: "centro", nuevo: false };
    const lista = porCliente.get(Number(customerId));
    const exacto = lista?.get(k);
    if (exacto) return { ...exacto, nuevo: false };
    if (/\bBINS\b/.test(k)) return { centro: "Bins", tipo: "bins", nuevo: true };
    for (const [otro, c] of lista ?? [])
      if (k.length >= 6 && otro.length >= 6 && numeros(otro) === numeros(k) && unaLetra(otro, k)) return { ...c, nuevo: true };
    return { centro: nombreBonito(contacto!), tipo: "centro", nuevo: true };
  };
}
export type CentroDe = ReturnType<typeof resolverCentros>;

