/**
 * Mismo producto entre empresas, con su conversion de formato, para sumar
 * ventas sin mezclar bandejas con huevos sueltos. La tabla sale de
 * scripts/generar-mismo-producto.mts (equivalencias de la guia manual +
 * factores confirmados del buscador de precios); un codigo que no esta en
 * ella es su propio grupo.
 */
import tabla from "./mismo-producto.json";
import type { ProductoAgregado } from "./indicadores";

const MISMO = tabla as unknown as Record<string, [string, number]>;

export interface Conversion {
  /** Codigo de referencia del grupo: su unidad de venta es la unidad comun. */
  referencia: string;
  /** Cuantas unidades de la referencia vale una unidad de este codigo. */
  factor: number;
}

export function conversionDe(codigo: string): Conversion {
  const fila = MISMO[codigo];
  return fila ? { referencia: fila[0], factor: fila[1] } : { referencia: codigo, factor: 1 };
}

const UNIDADES: [RegExp, string, string][] = [
  [/\bbandejas?\b/, "bandeja", "bandejas"],
  [/\b(bolsas?|bol)\b/, "bolsa", "bolsas"],
  [/\b(pqte|paquetes?|paq)\b/, "paquete", "paquetes"],
  [/\btarros?\b/, "tarro", "tarros"],
  [/\bsacos?\b/, "saco", "sacos"],
  [/\bsachet\b/, "sachet", "sachets"],
  [/\bpanes\b/, "pan", "panes"],
];

/**
 * Unidad en que se vende un producto, leida de su nombre: "kg" si se vende
 * por kilo ("PAPAS KG", "POLLO 1 KG"), el envase si lo nombra (bandeja,
 * bolsa...), y si no "un".
 */
export function unidadDeVenta(nombre: string, cantidad = 2): string {
  const n = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ");
  // "kg" solo o "1 kg": se vende por kilo. "BOLSA 2,5 kg" es una bolsa.
  const t = n.split(/\s+/);
  if (t.some((w, i) => /^(kgs?|kilos?)$/.test(w) && (i === 0 || !/^\d/.test(t[i - 1]) || t[i - 1] === "1"))) return "kg";
  for (const [re, uno, varios] of UNIDADES) if (re.test(n)) return cantidad === 1 ? uno : varios;
  return "un";
}

export interface ParteTop {
  producto: ProductoAgregado;
  unidad: string;
  /** Su cantidad expresada en la unidad de la fila. */
  equivalente: number;
}

export interface FilaTop {
  clave: string;
  nombre: string;
  /** En la unidad de venta del producto que da el nombre. */
  cantidad: number;
  unidad: string;
  monto: number;
  partes: ParteTop[];
}

/**
 * Junta el mismo producto de distintas empresas (tabla de arriba)
 * convirtiendo los formatos: 49 bandejas de Cermaq son 1.470 huevos. La fila
 * toma el nombre y la unidad de la parte que mas vendio.
 */
export function juntarMismoProducto(lista: ProductoAgregado[]): FilaTop[] {
  const grupos = new Map<string, ProductoAgregado[]>();
  for (const p of lista) {
    const clave = conversionDe(p.codigo).referencia;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }
  return [...grupos.entries()].map(([clave, productos]) => {
    // Todo a la unidad de la referencia del grupo, y de ahi a la de la parte mayor.
    const enReferencia = (p: ProductoAgregado) => p.cantidad * conversionDe(p.codigo).factor;
    const ordenados = [...productos].sort((a, b) => enReferencia(b) - enReferencia(a));
    const base = ordenados[0];
    const factorBase = conversionDe(base.codigo).factor;
    const cantidad = productos.reduce((s, p) => s + enReferencia(p), 0) / factorBase;
    return {
      clave,
      nombre: base.nombre,
      cantidad,
      unidad: unidadDeVenta(base.nombre, cantidad),
      monto: productos.reduce((s, p) => s + p.monto, 0),
      partes: ordenados.map((p) => ({
        producto: p,
        unidad: unidadDeVenta(p.nombre, p.cantidad),
        equivalente: enReferencia(p) / factorBase,
      })),
    };
  });
}
