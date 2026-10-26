/**
 * Escritor minimo de .xlsx (una hoja) con fflate, sin dependencias nuevas.
 * Sirve en el navegador y en el servidor. Los estilos son fijos (ESTILO):
 * suficientes para un Excel de revision legible, no un motor de formato.
 */
import { strToU8, zipSync } from "fflate";

export const ESTILO = {
  normal: 0,
  encabezado: 1,
  pesos: 2,
  ok: 3,
  revisar: 4,
  sinCalce: 5,
  pesosNegrita: 6,
  titulo: 7,
  ajustado: 8,
} as const;

export interface CeldaXlsx {
  v: string | number | null;
  s?: number;
}

export interface HojaXlsx {
  nombre: string;
  /** Ancho de cada columna en caracteres. */
  anchos: number[];
  filas: CeldaXlsx[][];
  /** Filas de arriba que quedan fijas al bajar (la del encabezado incluida). */
  filasFijas?: number;
  /** Rango con filtro, p. ej. "A4:M40". */
  filtro?: string;
}

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E7E5"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD7F2DC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1BF"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF9D3D0"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
</styleSheet>`;

function hojaXml(h: HojaXlsx): string {
  const cols = h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const filas = h.filas
    .map((fila, r) => {
      const celdas = fila
        .map((c, i) => {
          if (c.v == null || c.v === "") return c.s ? `<c r="${columna(i)}${r + 1}" s="${c.s}"/>` : "";
          const ref = `${columna(i)}${r + 1}`;
          const s = c.s ? ` s="${c.s}"` : "";
          if (typeof c.v === "number" && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(String(c.v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join("");
  const fijas = h.filasFijas
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${h.filasFijas}" topLeftCell="A${h.filasFijas + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const filtro = h.filtro ? `<autoFilter ref="${h.filtro}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fijas}<cols>${cols}</cols><sheetData>${filas}</sheetData>${filtro}</worksheet>`;
}

export function crearXlsx(hoja: HojaXlsx): Uint8Array {
  const nombre = xml(hoja.nombre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nombre}" sheetId="1" r:id="rId1"/></sheets>${
      hoja.filtro ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nombre}'!${hoja.filtro.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}</definedName></definedNames>` : ""
    }</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(hojaXml(hoja)),
  });
}
