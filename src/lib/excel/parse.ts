import "server-only";

import Papa from "papaparse";
import { leerLibro, listaHojas } from "./libro";
import type { ErrorParseo, FilaPedido, ResultadoParseo } from "./types";

const ALIAS_CODIGO = ["codigo", "código", "sku", "codigosku", "codigo sku"];
const ALIAS_CANTIDAD = ["cantidad", "cant"];
const ALIAS_CATEGORIA = ["categoria", "categoría", "familia"];
const ALIAS_NOMBRE = ["producto", "descripcion", "nombre", "detalle", "articulo"];

// En formato matriz cada columna es un centro de cultivo. Estas son las que
// aparecen en archivos reales sin serlo: tomarlas como centro generaria una
// guia a nombre de "TOTAL" con la suma de todo el pedido.
const COLUMNAS_NO_CENTRO = [
  "total",
  "totales",
  "suma",
  "subtotal",
  "observacion",
  "observaciones",
  "comentario",
  "comentarios",
  "nota",
  "notas",
  "producto",
  "descripcion",
  "nombre",
  "unidad",
  "um",
];

function normalizarHeader(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita tildes (marcas diacriticas combinantes)
}

function encontrarColumna(headers: string[], alias: string[]): number {
  const normalizados = headers.map(normalizarHeader);
  return normalizados.findIndex((h) => alias.includes(h));
}

function letraColumna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function esFilaVacia(row: unknown[] | undefined): boolean {
  return !row || row.every((celda) => celda === null || celda === undefined || celda === "");
}

function construirFilas(rows: unknown[][]): ResultadoParseo {
  const errores: ErrorParseo[] = [];

  // Tolera filas en blanco antes del encabezado real (ocurre en archivos de
  // Dilogic, ver CLAUDE.md).
  let headerIndex = 0;
  while (headerIndex < rows.length && esFilaVacia(rows[headerIndex])) headerIndex += 1;

  const headerRow = rows[headerIndex];
  if (!headerRow) {
    return { filas: [], errores: [{ fila: null, mensaje: "El archivo esta vacio." }] };
  }

  const headers = headerRow.map((h) => String(h ?? ""));
  const idxCodigo = encontrarColumna(headers, ALIAS_CODIGO);
  const idxCantidad = encontrarColumna(headers, ALIAS_CANTIDAD);
  const idxCategoria = encontrarColumna(headers, ALIAS_CATEGORIA);
  const idxNombre = encontrarColumna(headers, ALIAS_NOMBRE);
  const nombreDe = (row: unknown[]): string | null =>
    idxNombre !== -1 && row[idxNombre] != null ? String(row[idxNombre]).trim() || null : null;

  if (idxCodigo === -1) {
    errores.push({
      fila: null,
      mensaje: `No se procesó el archivo: falta la columna «código» en la fila de títulos (fila ${headerIndex + 1}).`,
    });
    return { filas: [], errores };
  }

  const dataRows = rows.slice(headerIndex + 1);
  const filas: FilaPedido[] = [];

  // Formato largo: una columna "cantidad", un solo centro por archivo (el
  // contacto se ingresa manualmente al generar las guias).
  if (idxCantidad !== -1) {
    dataRows.forEach((row, i) => {
      const numeroFila = headerIndex + i + 2; // +1 por encabezado, +1 por indice base 1
      const codigo = String(row[idxCodigo] ?? "").trim();
      const cantidadRaw = row[idxCantidad];
      const categoria =
        idxCategoria !== -1 && row[idxCategoria] != null
          ? String(row[idxCategoria]).trim() || null
          : null;

      if (!codigo && (cantidadRaw === undefined || cantidadRaw === null || cantidadRaw === "")) {
        return; // fila vacia, se ignora silenciosamente
      }

      if (!codigo) {
        errores.push({ fila: numeroFila, mensaje: "Falta el codigo." });
        return;
      }

      const cantidad = typeof cantidadRaw === "number" ? cantidadRaw : Number(cantidadRaw);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        errores.push({
          fila: numeroFila,
          mensaje: `Cantidad invalida para el codigo ${codigo}: "${cantidadRaw ?? ""}".`,
        });
        return;
      }

      filas.push({
        fila: numeroFila,
        codigo,
        cantidad,
        categoria,
        centro: null,
        nombreArchivo: nombreDe(row),
      });
    });

    return { filas, errores };
  }

  // Formato matriz: sin columna "cantidad" propia, cada columna restante es
  // un centro de cultivo distinto (ej. CODIGO | CHALACAYEC | QUEMADA | ...) y
  // cada celda es la cantidad pedida por ese centro para ese codigo.
  const columnasCentro = headers
    .map((nombre, idx) => ({ idx, nombre: nombre.trim() }))
    .filter(
      ({ idx, nombre }) =>
        idx !== idxCodigo &&
        idx !== idxCategoria &&
        idx !== idxNombre &&
        nombre !== "" &&
        !COLUMNAS_NO_CENTRO.includes(normalizarHeader(nombre))
    );

  // Una columna con cantidades y sin titulo no se puede asignar a ningun
  // centro: ignorarla dejaria productos fuera de las guias sin avisar.
  const anchoDatos = Math.max(headers.length, ...dataRows.map((r) => r?.length ?? 0));
  const sinNombre: string[] = [];
  for (let idx = 0; idx < anchoDatos; idx += 1) {
    if ([idxCodigo, idxCategoria, idxNombre].includes(idx) || (headers[idx] ?? "").trim() !== "") continue;
    const numeros = dataRows
      .map((r) => r?.[idx])
      .filter((v) => v != null && String(v).trim() !== "" && Number.isFinite(Number(v)))
      .map(Number);
    // Un correlativo (1, 2, 3...) sin titulo es la numeracion de las filas, no un centro.
    const esCorrelativo = numeros.length > 1 && numeros.every((n, i) => i === 0 || n === numeros[i - 1] + 1);
    if (numeros.length > 0 && !esCorrelativo) sinNombre.push(letraColumna(idx));
  }
  if (sinNombre.length > 0) {
    errores.push({
      fila: null,
      mensaje: `No se procesó el archivo: ${sinNombre.length === 1 ? `la columna ${sinNombre[0]} trae` : `las columnas ${sinNombre.join(", ")} traen`} cantidades pero no ${sinNombre.length === 1 ? "tiene" : "tienen"} el nombre del centro en la fila de títulos (fila ${headerIndex + 1}). Escribe el nombre del centro y vuelve a subirlo.`,
    });
    return { filas: [], errores };
  }

  if (columnasCentro.length === 0) {
    errores.push({
      fila: null,
      mensaje: `No se procesó el archivo: falta la columna «cantidad» o, si el pedido es por centro, una columna por centro con su nombre en la fila de títulos (fila ${headerIndex + 1}).`,
    });
    return { filas: [], errores };
  }

  dataRows.forEach((row, i) => {
    const numeroFila = headerIndex + i + 2;
    const codigo = String(row[idxCodigo] ?? "").trim();
    const categoria =
      idxCategoria !== -1 && row[idxCategoria] != null
        ? String(row[idxCategoria]).trim() || null
        : null;

    if (esFilaVacia(row)) return; // fila vacia, se ignora silenciosamente
    if (!codigo) {
      errores.push({ fila: numeroFila, mensaje: "Falta el codigo." });
      return;
    }

    for (const { idx, nombre: centro } of columnasCentro) {
      const cantidadRaw = row[idx];
      if (cantidadRaw === undefined || cantidadRaw === null || cantidadRaw === "") continue;

      const cantidad = typeof cantidadRaw === "number" ? cantidadRaw : Number(cantidadRaw);
      if (!Number.isFinite(cantidad)) {
        errores.push({
          fila: numeroFila,
          mensaje: `Cantidad invalida para el codigo ${codigo} en ${centro}: "${cantidadRaw}".`,
        });
        continue;
      }
      if (cantidad <= 0) continue; // 0 o negativo: no hay pedido de ese producto para ese centro

      filas.push({ fila: numeroFila, codigo, cantidad, categoria, centro, nombreArchivo: nombreDe(row) });
    }
  });

  return { filas, errores };
}

export async function parseArchivoPedidoCsv(buffer: Buffer): Promise<ResultadoParseo> {
  const texto = buffer.toString("utf8");
  const { data } = Papa.parse<string[]>(texto, { skipEmptyLines: true });
  return construirFilas(data);
}

/**
 * Lee la primera hoja VISIBLE. Las ocultas nunca se procesan y las demas
 * visibles tampoco (un pedido va en una hoja); en ambos casos se avisa cuales
 * quedaron fuera, para que quien sube el archivo sepa que no se leyeron.
 */
export async function parseArchivoPedidoXlsx(buffer: Buffer): Promise<ResultadoParseo> {
  const hojas = await leerLibro(buffer);
  if (hojas.length === 0) {
    return { filas: [], errores: [{ fila: null, mensaje: "El archivo no tiene hojas." }] };
  }
  const visibles = hojas.filter((h) => !h.oculta);
  const ocultas = hojas.filter((h) => h.oculta).map((h) => h.nombre);
  const avisos: ErrorParseo[] = [];
  if (ocultas.length > 0) {
    avisos.push({ fila: null, tipo: "aviso", mensaje: `No se procesó ${listaHojas(ocultas)}: ${ocultas.length === 1 ? "está oculta" : "están ocultas"} en el Excel.` });
  }
  const [hoja, ...otras] = visibles;
  if (!hoja) {
    return { filas: [], errores: [{ fila: null, mensaje: "No se procesó el archivo: todas sus hojas están ocultas." }, ...avisos] };
  }
  if (otras.length > 0) {
    avisos.push({ fila: null, tipo: "aviso", mensaje: `Se leyó solo la hoja «${hoja.nombre}». No se procesó ${listaHojas(otras.map((h) => h.nombre))}.` });
  }
  const resultado = construirFilas(hoja.data);
  return { filas: resultado.filas, errores: [...resultado.errores, ...avisos] };
}

export async function parseArchivoPedido(
  buffer: Buffer,
  nombreArchivo: string
): Promise<ResultadoParseo> {
  const extension = nombreArchivo.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseArchivoPedidoCsv(buffer);
  if (extension === "xlsx") return parseArchivoPedidoXlsx(buffer);
  if (extension === "xls") {
    return { filas: [], errores: [{ fila: null, mensaje: "No se procesó el archivo: es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx." }] };
  }
  return {
    filas: [],
    errores: [{ fila: null, mensaje: `Formato de archivo no soportado: .${extension}` }],
  };
}
