import { getDocumentProxy } from "unpdf";

/**
 * Lee una factura de proveedor en PDF (formato MetodoPOS, el que usa el
 * proveedor de PALVITAD) y devuelve sus lineas y totales. Las facturas de
 * este proveedor llegan a Relbase como compra pero sin detalle (sin XML), asi
 * que el PDF es la unica fuente de los productos; los totales se cruzan
 * despues con la compra registrada en Relbase (ver traspaso/compras.ts).
 */

export interface LineaFactura {
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Precio unitario tal como viene: con IVA y, si aplica, impuestos especificos. */
  precio: number;
  /** Total de la linea segun la factura (manda sobre cantidad x precio: la
   * cantidad viene redondeada a 2 decimales y el total usa el peso exacto). */
  total: number;
}

export interface FacturaLeida {
  folio: string;
  rutEmisor: string | null;
  fecha: string | null;
  subtotal: number;
  neto: number;
  iva: number;
  total: number;
  lineas: LineaFactura[];
  /** Problemas de lectura; si hay alguno, la factura no se puede usar. */
  problemas: string[];
}

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07",
  agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** "2.704" -> 2704; "6,23" -> 6.23 (formato chileno). */
function numero(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

/** Rearma los renglones del PDF: el texto viene en trozos con coordenadas. */
async function renglones(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(pdf);
  // Solo la pagina 1: la 2 es la copia cedible, identica.
  const pagina = await doc.getPage(1);
  const { items } = await pagina.getTextContent();
  const filas: { y: number; partes: { x: number; texto: string }[] }[] = [];
  for (const item of items as { str?: string; transform: number[] }[]) {
    const texto = item.str?.trim();
    if (!texto) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let fila = filas.find((f) => Math.abs(f.y - y) < 2);
    if (!fila) {
      fila = { y, partes: [] };
      filas.push(fila);
    }
    fila.partes.push({ x, texto });
  }
  return filas
    .sort((a, b) => b.y - a.y)
    .map((f) => f.partes.sort((a, b) => a.x - b.x).map((p) => p.texto).join(" "));
}

const RE_LINEA = /^(\d+)\s+(.+?)\s+(\d+,\d{2})\s+UNID\s+([\d.]+)\s+(\d+)\s+([\d.]+)$/;

export async function leerFacturaProveedor(pdf: Uint8Array): Promise<FacturaLeida> {
  const lineasTexto = await renglones(pdf);
  const texto = lineasTexto.join("\n");
  const problemas: string[] = [];

  const monto = (patron: string, nombre: string) => {
    const m = texto.match(new RegExp(`${patron}\\s*:\\s*\\$\\s*([\\d.]+)`));
    if (!m) problemas.push(`No se encontró el ${nombre}.`);
    return m ? numero(m[1]) : 0;
  };

  const folio = texto.match(/N°\s*(\d+)/)?.[1] ?? "";
  if (!folio) problemas.push("No se encontró el número de factura.");
  const rutEmisor = texto.match(/R\.U\.T\.:\s*([\d.]+-[\dkK])/)?.[1] ?? null;
  const f = texto.match(/(\d{1,2}) de (\w+) del (\d{4})/i);
  const fecha = f ? `${f[3]}-${MESES[f[2].toLowerCase()] ?? "01"}-${f[1].padStart(2, "0")}` : null;

  const lineas: LineaFactura[] = [];
  for (const renglon of lineasTexto) {
    const m = renglon.match(RE_LINEA);
    if (!m) continue;
    // m[5] es el descuento: estas facturas nunca lo traen; si apareciera, el
    // total de la linea (m[6]) ya lo considera.
    lineas.push({ codigo: m[1], nombre: m[2], cantidad: numero(m[3]), precio: numero(m[4]), total: numero(m[6]) });
  }

  const subtotal = monto("Sub-Total", "Sub-Total");
  const neto = monto("Neto", "Neto");
  const iva = monto("I\\.V\\.A", "IVA");
  const total = monto("TOTAL", "Total");

  if (lineas.length === 0) problemas.push("No se reconoció ninguna línea de producto.");
  const suma = lineas.reduce((n, l) => n + l.total, 0);
  // La verificacion que importa: si falta o sobra una linea, no cuadra.
  if (lineas.length > 0 && suma !== subtotal) {
    problemas.push(`Las líneas suman $${suma.toLocaleString("es-CL")} y el Sub-Total dice $${subtotal.toLocaleString("es-CL")}.`);
  }

  return { folio, rutEmisor, fecha, subtotal, neto, iva, total, lineas, problemas };
}
