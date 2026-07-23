import "server-only";

import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import type { ErrorParseo, FilaPedido, ResultadoParseo } from "./types";

const ALIAS_CODIGO = ["codigo", "código", "sku", "codigosku", "codigo sku"];
const ALIAS_CANTIDAD = ["cantidad", "cant"];
const ALIAS_CATEGORIA = ["categoria", "categoría", "familia"];

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

  if (idxCodigo === -1) {
    errores.push({
      fila: null,
      mensaje:
        "No se encontraron las columnas requeridas 'codigo' y 'cantidad' en el archivo.",
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

      filas.push({ fila: numeroFila, codigo, cantidad, categoria, centro: null });
    });

    return { filas, errores };
  }

  // Formato matriz: sin columna "cantidad" propia, cada columna restante es
  // un centro de cultivo distinto (ej. CODIGO | CHALACAYEC | QUEMADA | ...) y
  // cada celda es la cantidad pedida por ese centro para ese codigo.
  const columnasCentro = headers
    .map((nombre, idx) => ({ idx, nombre: nombre.trim() }))
    .filter(({ idx, nombre }) => idx !== idxCodigo && idx !== idxCategoria && nombre !== "");

  if (columnasCentro.length === 0) {
    errores.push({
      fila: null,
      mensaje:
        "No se encontraron las columnas requeridas 'codigo' y 'cantidad' en el archivo.",
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

      filas.push({ fila: numeroFila, codigo, cantidad, categoria, centro });
    }
  });

  return { filas, errores };
}

export async function parseArchivoPedidoCsv(buffer: Buffer): Promise<ResultadoParseo> {
  const texto = buffer.toString("utf8");
  const { data } = Papa.parse<string[]>(texto, { skipEmptyLines: true });
  return construirFilas(data);
}

export async function parseArchivoPedidoXlsx(buffer: Buffer): Promise<ResultadoParseo> {
  const hojas = await readXlsxFile(buffer);
  const primeraHoja = hojas[0];
  if (!primeraHoja) {
    return { filas: [], errores: [{ fila: null, mensaje: "El archivo no tiene hojas." }] };
  }
  return construirFilas(primeraHoja.data);
}

export async function parseArchivoPedido(
  buffer: Buffer,
  nombreArchivo: string
): Promise<ResultadoParseo> {
  const extension = nombreArchivo.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseArchivoPedidoCsv(buffer);
  if (extension === "xlsx" || extension === "xls") return parseArchivoPedidoXlsx(buffer);
  return {
    filas: [],
    errores: [{ fila: null, mensaje: `Formato de archivo no soportado: .${extension}` }],
  };
}
