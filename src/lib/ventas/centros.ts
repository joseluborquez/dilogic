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
