/**
 * Donde esta cada dato en el listado de un cliente externo: no hay formato
 * fijo, asi que se adivina el encabezado y las columnas, y la pantalla deja
 * corregirlos. Sin dependencias de servidor.
 */
import { normalizarTexto, type FilaListado } from "./cruce";

export type Celda = string | number | null;

export interface Columnas {
  /** Indice (0 = primera fila) de la fila de encabezados. */
  encabezado: number;
  descripcion: number | null;
  cantidad: number | null;
  /** "Cant. real": lo que de verdad se despacha (carne pesada, faltantes); si esta llena, manda sobre la cantidad pedida. */
  cantidadReal: number | null;
  codigo: number | null;
  unidad: number | null;
  precio: number | null;
}

const ALIAS = {
  // "Pedido ..." primero: en una propuesta ya armada es lo que escribio el cliente; "Producto ..." puede ser nuestro nombre.
  descripcion: ["pedido", "producto", "productos", "descripcion", "detalle", "articulo", "nombre", "glosa", "insumo", "material", "nombre producto", "descripcion producto"],
  cantidad: ["cantidad", "cant", "cant.", "qty", "unidades", "solicitado", "pedido", "cantidad solicitada"],
  cantidadReal: ["cant real", "cantidad real", "cant despachada", "cantidad despachada"],
  codigo: ["codigo", "cod", "cod.", "sku", "codigo producto", "codigo sku"],
  // "neto" o "valor" a secas suelen ser el total de la linea, no el precio unitario.
  precio: ["precio", "precio unitario", "precio neto", "p unitario", "valor unitario"],
  unidad: ["unidad", "un", "und", "um", "u m", "u/m", "unidad medida", "unidad de medida", "formato", "medida"],
};

const normal = (v: Celda) => normalizarTexto(String(v ?? "")).replace(/\./g, "").replace(/\s+/g, " ").trim();

/** La columna cuyo titulo es el primer alias que aparezca (en orden de preferencia). */
function buscar(fila: Celda[], alias: string[]): number | null {
  const titulos = fila.map(normal);
  for (const a of alias) {
    const i = titulos.indexOf(a);
    if (i !== -1) return i;
  }
  // "Cant. Solicitada", "Descripcion del producto": basta con que empiece por un alias de una palabra.
  for (const a of alias.filter((x) => !x.includes(" "))) {
    const i = titulos.findIndex((t) => t.split(" ")[0] === a);
    if (i !== -1) return i;
  }
  return null;
}

export function sugerirColumnas(filas: Celda[][]): Columnas {
  // El encabezado: la primera fila (de las 20 primeras) que nombra producto o cantidad.
  // (Con al menos dos celdas llenas: un titulo suelto como "Pedido de viveres" no es encabezado.)
  let encabezado = filas
    .slice(0, 20)
    .findIndex((f) => f.filter((c) => c != null && c !== "").length >= 2 && (buscar(f, ALIAS.descripcion) != null || buscar(f, ALIAS.cantidad) != null));
  if (encabezado === -1) encabezado = Math.max(0, filas.findIndex((f) => f.some((c) => c != null && c !== "")));
  const cab = filas[encabezado] ?? [];
  const datos = filas.slice(encabezado + 1, encabezado + 60);
  const ancho = Math.max(0, ...filas.map((f) => f.length));

  let descripcion = buscar(cab, ALIAS.descripcion);
  // Titulada "producto" pero con puros numeros (un correlativo): no sirve como descripcion.
  if (descripcion != null && !datos.some((f) => typeof f[descripcion!] === "string" && /[a-z]{3}/i.test(String(f[descripcion!])))) descripcion = null;
  const cantidadReal = buscar(cab, ALIAS.cantidadReal);
  let cantidad = buscar(cab.map((c, i) => (i === cantidadReal || i === descripcion ? null : c)), ALIAS.cantidad);
  const codigo = buscar(cab, ALIAS.codigo);
  const unidad = buscar(cab, ALIAS.unidad);
  const precio = buscar(cab, ALIAS.precio);

  // Sin nombre reconocible: la columna con mas texto es la descripcion y la mas numerica, la cantidad.
  const usadas = new Set([descripcion, cantidad, cantidadReal, codigo, unidad, precio].filter((x): x is number => x != null));
  if (descripcion == null) {
    let mejor = -1;
    for (let i = 0; i < ancho; i += 1) {
      if (usadas.has(i)) continue;
      const largo = datos.reduce((s, f) => s + (typeof f[i] === "string" && /[a-z]{3}/i.test(String(f[i])) ? String(f[i]).length : 0), 0);
      if (largo > mejor) [mejor, descripcion] = [largo, i];
    }
    if (mejor <= 0) descripcion = null;
    else usadas.add(descripcion!);
  }
  if (cantidad == null) {
    let mejor = 0;
    for (let i = 0; i < ancho; i += 1) {
      if (usadas.has(i)) continue;
      const numeros = datos.filter((f) => leerCantidad(f[i]) != null).length;
      if (numeros > mejor) [mejor, cantidad] = [numeros, i];
    }
  }
  return { encabezado, descripcion, cantidad, cantidadReal, codigo, unidad, precio };
}

/** "2", 2, "2,5", "3 kg" → numero; lo demas → null. */
export function leerCantidad(v: Celda): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v ?? "").trim().match(/^(\d+(?:[.,]\d+)?)(\s*[a-z.]*)?$/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** 1990, "1990", "$1.990", "1.990,5" -> numero; lo demas -> null. */
export function leerPrecio(v: Celda): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const t = String(v ?? "").replace(/[$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

const NO_ES_PRODUCTO = /^(total|totales|subtotal|suma|neto|iva|observaciones?|notas?|firma)\b/;

/**
 * Las lineas del listado segun las columnas elegidas (sin filas vacias ni
 * totales). `omitirSinCantidad`: muchas planillas traen todo el surtido y el
 * cliente solo llena la cantidad de lo que pide.
 */
export function leerFilas(filas: Celda[][], col: Columnas, omitirSinCantidad = true): FilaListado[] {
  // Sin columna de nombre basta el codigo (listados "codigo | cantidad").
  const colTexto = col.descripcion ?? col.codigo;
  if (colTexto == null) return [];
  const texto = (f: Celda[], i: number | null) => (i == null || f[i] == null ? "" : String(f[i]).trim());
  return filas
    .map((f, r) => ({ f, r }))
    .slice(col.encabezado + 1)
    .map(({ f, r }) => {
      const real = col.cantidadReal == null ? null : leerCantidad(f[col.cantidadReal]);
      return { f, r, real };
    })
    .map(({ f, r, real }) => ({
      fila: r + 1,
      texto: texto(f, colTexto),
      codigo: texto(f, col.codigo) || null,
      cantidad: real ?? (col.cantidad == null ? null : leerCantidad(f[col.cantidad])),
      cantidadOriginal: real != null ? texto(f, col.cantidadReal) : texto(f, col.cantidad),
      unidad: texto(f, col.unidad) || null,
      precio: col.precio == null ? null : leerPrecio(f[col.precio]),
    }))
    .filter((l) => /[a-z]{2}/i.test(l.texto) && !NO_ES_PRODUCTO.test(normalizarTexto(l.texto)))
    .filter((l) => !omitirSinCantidad || l.cantidadOriginal !== "" && l.cantidad !== 0);
}
