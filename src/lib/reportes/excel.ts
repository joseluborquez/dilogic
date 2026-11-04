import { ESTILO, columna, crearXlsxLibro, fechaExcel, type CeldaXlsx, type HojaXlsx } from "@/lib/excel/escribir";
import type { EmpresaReporte, GuiaReporte, LineaReporte } from "./datos";

/**
 * Excel de cada empresa con el formato de los resumenes que Hugo armaba a mano
 * (septiembre 2026, en DILOGIC 2026/SEPTIEMBRE 2026). Sin colores; fechas como
 * fecha real (03-09-2026) y totales con formula.
 */

const N = ESTILO.negrita;
const vacia: CeldaXlsx = { v: null };
const texto = (v: string, s?: number): CeldaXlsx => ({ v, s });
const fecha = (iso: string): CeldaXlsx => ({ v: fechaExcel(iso), s: ESTILO.fecha });
const pesos = (v: number): CeldaXlsx => ({ v, s: ESTILO.pesos });
const suma = (col: number, desde: number, hasta: number): CeldaXlsx => ({
  v: null,
  f: hasta >= desde ? `SUM(${columna(col)}${desde}:${columna(col)}${hasta})` : "0",
  s: ESTILO.pesosNegrita,
});

/** dd-mm-yyyy, siempre completa (Hugo, 03-11). */
export const fechaTexto = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

const ENCABEZADO = ["Contacto", "Nº Guía", "Fecha emisión", "Neto"];

const porCentro = (a: GuiaReporte, b: GuiaReporte) => a.centro.localeCompare(b.centro, "es");

/** Cermaq: zona SUR a la izquierda y NORTE a la derecha, por centro y folio descendente. */
function hojaCermaq(sur: GuiaReporte[], norte: GuiaReporte[]): HojaXlsx {
  const orden = (l: GuiaReporte[]) => [...l].sort((a, b) => porCentro(a, b) || b.folio - a.folio);
  const columnas = [orden(sur), orden(norte)];
  const inicio = [0, 6]; // A..D y G..J, con dos columnas en blanco entre medio
  const alto = Math.max(columnas[0].length, columnas[1].length) + 2;
  const filas: CeldaXlsx[][] = Array.from({ length: alto }, () => Array.from({ length: 10 }, () => vacia));
  columnas.forEach((lista, z) => {
    const c = inicio[z];
    ENCABEZADO.forEach((t, i) => (filas[0][c + i] = texto(t, N)));
    lista.forEach((g, i) => {
      filas[i + 1][c] = texto(g.centro);
      filas[i + 1][c + 1] = { v: g.folio };
      filas[i + 1][c + 2] = fecha(g.fecha);
      filas[i + 1][c + 3] = pesos(g.neto);
    });
    filas[lista.length + 1][c + 2] = texto("TOTAL", N);
    filas[lista.length + 1][c + 3] = suma(c + 3, 2, lista.length + 1);
  });
  return { nombre: "RESUMEN", anchos: [22, 10, 14, 14, 4, 4, 22, 10, 14, 14], filas, filasFijas: 1 };
}

/** Multiexport: GUIA (por centro, neto ascendente) + DETALLE GUIA (producto por producto). */
function hojasMultiX(guias: GuiaReporte[], lineas: LineaReporte[]): HojaXlsx[] {
  const lista = [...guias].sort((a, b) => porCentro(a, b) || a.neto - b.neto || a.folio - b.folio);
  const guia: CeldaXlsx[][] = [
    ENCABEZADO.map((t) => texto(t, N)),
    ...lista.map((g) => [texto(g.centro), { v: g.folio }, fecha(g.fecha), pesos(g.neto)]),
    [vacia, vacia, texto("TOTAL", N), suma(3, 2, lista.length + 1)],
  ];

  const deGuia = new Map(guias.map((g) => [g.dteId, g]));
  const detalle = lineas
    .filter((l) => deGuia.has(l.dteId))
    .map((l) => ({ l, g: deGuia.get(l.dteId)! }))
    .sort((a, b) => porCentro(a.g, b.g) || a.l.precio - b.l.precio || a.g.folio - b.g.folio || a.l.linea - b.l.linea);
  const filasDetalle: CeldaXlsx[][] = [
    ["CENTRO", "Nº Guía", "Fecha emisión", "Código", "Producto", "Cantidad", "Precio"].map((t) => texto(t, N)),
    ...detalle.map(({ l, g }) => [
      texto(g.centro),
      { v: g.folio },
      fecha(g.fecha),
      texto(l.codigo),
      texto(l.producto),
      { v: l.cantidad },
      pesos(l.precio),
    ]),
  ];
  return [
    { nombre: "GUIA", anchos: [24, 10, 14, 14], filas: guia, filasFijas: 1 },
    {
      nombre: "DETALLE GUIA",
      anchos: [24, 10, 14, 14, 44, 10, 12],
      filas: filasDetalle,
      filasFijas: 1,
      filtro: `A1:G${filasDetalle.length}`,
    },
  ];
}

/** PALVITAD va al final, como en los resumenes de Hugo. */
const ordenYadran = (a: string, b: string) => Number(a === "PALVITAD") - Number(b === "PALVITAD") || a.localeCompare(b, "es");

/** Yadran: CUADRO RESUMEN (neto por centro, formula a la otra hoja) + CENTROS GUIAS (un bloque por centro). */
function hojasYadran(guias: GuiaReporte[]): HojaXlsx[] {
  const centros = [...new Set(guias.map((g) => g.centro))].sort(ordenYadran);
  const bloques: CeldaXlsx[][] = [];
  const filaTotal = new Map<string, number>();
  for (const centro of centros) {
    const lista = guias.filter((g) => g.centro === centro).sort((a, b) => a.fecha.localeCompare(b.fecha) || b.folio - a.folio);
    if (bloques.length) bloques.push([], []);
    bloques.push(ENCABEZADO.map((t) => texto(t, N)));
    const primera = bloques.length + 1;
    for (const g of lista) bloques.push([texto(g.centro), { v: g.folio }, fecha(g.fecha), pesos(g.neto)]);
    bloques.push([vacia, vacia, texto("TOTAL", N), suma(3, primera, bloques.length)]);
    filaTotal.set(centro, bloques.length);
  }

  const cuadro: CeldaXlsx[][] = [
    [texto("SERVICIO APROVISIONAMIENTO DE VIVERES", N)],
    ["Contacto", "Nº FACTURA", "Fecha emisión", "Neto"].map((t) => texto(t, N)),
    ...centros.map((c) => [texto(c), vacia, vacia, { v: null, f: `'CENTROS GUIAS'!D${filaTotal.get(c)}`, s: ESTILO.pesos }]),
    [vacia, vacia, texto("TOTAL", N), suma(3, 3, centros.length + 2)],
  ];
  return [
    { nombre: "CUADRO RESUMEN", anchos: [24, 12, 14, 16], filas: cuadro, combinadas: ["A1:D1"] },
    { nombre: "CENTROS GUIAS", anchos: [24, 10, 14, 14], filas: bloques },
  ];
}

export interface ReporteArmado {
  nombreArchivo: string;
  contenido: Uint8Array;
}

const tramo = (r: { desde: string; hasta: string }) => `${fechaTexto(r.desde)} al ${fechaTexto(r.hasta)}`;

export function armarReporte(
  empresa: EmpresaReporte,
  periodo: { desde: string; hasta: string },
  guias: GuiaReporte[],
  lineas: LineaReporte[] = []
): ReporteArmado {
  if (empresa === "CERQ") {
    const sur = guias.filter((g) => g.zona === "SUR");
    const norte = guias.filter((g) => g.zona === "NORTE");
    return {
      nombreArchivo: `RESUMEN CERMAQ - ${tramo(periodo)}.xlsx`,
      contenido: crearXlsxLibro([hojaCermaq(sur, norte)]),
    };
  }
  const p = periodo;
  if (empresa === "MTX") {
    return { nombreArchivo: `RESUMEN MULTI X - ${tramo(p)}.xlsx`, contenido: crearXlsxLibro(hojasMultiX(guias, lineas)) };
  }
  return { nombreArchivo: `RESUMEN YADRAN - ${tramo(p)}.xlsx`, contenido: crearXlsxLibro(hojasYadran(guias)) };
}
