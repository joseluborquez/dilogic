import "server-only";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import readXlsxFile from "read-excel-file/node";

export interface HojaLibro {
  nombre: string;
  /** Oculta en Excel (state="hidden" o "veryHidden"): nunca se procesa. */
  oculta: boolean;
  data: unknown[][];
}

/**
 * Las hojas de un .xlsx con su visibilidad. read-excel-file no informa si una
 * hoja esta oculta, asi que se lee xl/workbook.xml directamente: una hoja
 * oculta suele ser una copia vieja o una tabla auxiliar, y procesarla
 * generaria guias que nadie pidio.
 */
export async function leerLibro(buffer: Buffer): Promise<HojaLibro[]> {
  let hojas: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    hojas = await readXlsxFile(buffer);
  } catch (e) {
    // Algunos programas escriben celdas vacias como <c t="inlineStr"></c> y
    // read-excel-file se cae con ellas: se limpian y se vuelve a leer.
    if (!/inline string/i.test(String(e))) throw e;
    hojas = await readXlsxFile(limpiarCeldasVacias(buffer));
  }
  const ocultas = new Set<string>();
  try {
    const { "xl/workbook.xml": workbook } = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === "xl/workbook.xml" });
    if (workbook) {
      for (const [etiqueta] of strFromU8(workbook).matchAll(/<sheet\b[^>]*>/g)) {
        const nombre = etiqueta.match(/\bname="([^"]*)"/)?.[1];
        if (nombre && /\bstate="(hidden|veryHidden)"/.test(etiqueta)) ocultas.add(desescapar(nombre));
      }
    }
  } catch {
    // Sin workbook.xml legible se asume que todas son visibles.
  }
  return hojas.map((h) => ({ nombre: h.sheet, oculta: ocultas.has(h.sheet), data: h.data as unknown[][] }));
}

/** Quita el tipo "inlineStr" de las celdas sin contenido, que quedan como celdas vacias normales. */
function limpiarCeldasVacias(buffer: Buffer): Buffer {
  const archivos = unzipSync(new Uint8Array(buffer));
  for (const [nombre, contenido] of Object.entries(archivos)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(nombre)) continue;
    const xml = strFromU8(contenido)
      .replace(/<c\b([^>]*?)\s+t="inlineStr"([^>]*?)\s*\/>/g, "<c$1$2/>")
      .replace(/<c\b([^>]*?)\s+t="inlineStr"([^>]*?)>\s*(<is>\s*(<t[^>]*>\s*<\/t>|<t[^>]*\/>)?\s*<\/is>)?\s*<\/c>/g, "<c$1$2/>");
    archivos[nombre] = strToU8(xml);
  }
  return Buffer.from(zipSync(archivos));
}

function desescapar(t: string): string {
  return t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** "las hojas «Viejo» y «Base»". */
export function listaHojas(nombres: string[]): string {
  const comillas = nombres.map((n) => `«${n}»`);
  if (comillas.length === 1) return `la hoja ${comillas[0]}`;
  return `las hojas ${comillas.slice(0, -1).join(", ")} y ${comillas.at(-1)}`;
}
