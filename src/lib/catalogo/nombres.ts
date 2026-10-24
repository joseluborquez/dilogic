/**
 * Compara el nombre que trae un pedido con el del producto en el catalogo,
 * para advertir codigos equivocados (ej. el archivo dice "CALDO COSTILLA"
 * pero el codigo es "CALDO AVE"). Los nombres de los clientes nunca calzan
 * letra por letra con Relbase, asi que se compara por palabras importantes:
 * sin tildes, mayusculas, unidades de empaque ni plurales.
 */

/** Palabras que no distinguen un producto de otro. */
const IGNORADAS = new Set([
  "de", "del", "la", "el", "los", "las", "y", "o", "en", "para", "al", "x",
  "un", "und", "unid", "unidad", "unidade", "kg", "kgs", "kilo", "gr", "grs", "g",
  "gramo", "lt", "lts", "litro", "l", "ml", "cc", "pqte", "paquete", "bot",
  "botella", "saco", "pote", "frasco", "bolsa", "lata", "sobre", "pet", "nac",
]);

/**
 * Palabras que distinguen variantes del mismo producto: si solo uno de los
 * nombres la tiene, son productos distintos aunque el resto calce ("COCA-COLA"
 * vs "COCA-COLA LIGHT", "AGUA C/GAS" vs "AGUA S/GAS"). Medido sobre el
 * catalogo: sin esta regla se escapaba 1 de cada 8 codigos cruzados.
 */
const VARIANTES = new Set([
  "light", "zero", "diet", "integral", "descremada", "semidescremada", "lactosa",
  "dulce", "amargo", "sin", "con", "picante",
]);

function raiz(palabra: string): string {
  // Plural simple: "manzanas" -> "manzana", "limones" -> "limon".
  if (palabra.length > 5 && palabra.endsWith("es")) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith("s")) return palabra.slice(0, -1);
  return palabra;
}

function palabras(nombre: string): Set<string> {
  const limpio = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // "c/gas", "s/hueso": abreviaturas de con/sin, que si distinguen.
    .replace(/\bc\//g, "con ")
    .replace(/\bs\//g, "sin ")
    .replace(/[^a-z0-9]+/g, " ");
  const resultado = new Set<string>();
  for (const p of limpio.split(" ")) {
    if (!p) continue;
    const r = raiz(p);
    // Letras sueltas y unidades no distinguen productos.
    if (r.length < 2 && !/\d/.test(r)) continue;
    if (IGNORADAS.has(p) || IGNORADAS.has(r)) continue;
    resultado.add(r);
  }
  return resultado;
}

/**
 * true si parecen el mismo producto. Coinciden si las palabras de uno estan
 * todas en el otro ("AZUCAR" vs "AZUCAR GRANULADA"), o si comparten mas de la
 * mitad; salvo que solo uno tenga una palabra de variante (light, sin, ...).
 * Ante la duda (un nombre vacio) se da por coincidente: es solo una
 * advertencia y una falsa alarma cuesta la confianza del operador.
 */
export function nombresCoinciden(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.size === 0 || pb.size === 0) return true;
  for (const v of VARIANTES) if (pa.has(v) !== pb.has(v)) return false;
  // Ambos dicen un tamano y no comparten ninguna cifra: "1,6 LT" vs "500 CC".
  const cifrasA = [...pa].filter((p) => /^\d+$/.test(p));
  const cifrasB = new Set([...pb].filter((p) => /^\d+$/.test(p)));
  if (cifrasA.length > 0 && cifrasB.size > 0 && !cifrasA.some((c) => cifrasB.has(c))) return false;
  let comunes = 0;
  for (const p of pa) if (pb.has(p)) comunes += 1;
  return comunes === Math.min(pa.size, pb.size) || comunes / Math.max(pa.size, pb.size) > 0.5;
}
