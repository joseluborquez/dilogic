import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { dividirEnLotes } from "@/lib/util/lotes";
import { unificarCentros } from "@/lib/ventas/centros";
import { guiasNuevasDeHoy, lineasDeHoy } from "@/lib/ventas/hoy";
import { empresasPorCliente, esBins, hoyChile } from "@/lib/ventas/indicadores";

/**
 * Datos de los reportes por empresa (Cermaq, Multiexport, Yadran), leidos de
 * ventas_guias / ventas_lineas: lo sincronizado cada manana desde Relbase.
 * Lo emitido hoy se lee directo de Relbase (lib/ventas/hoy), para poder
 * cerrar un reporte el mismo dia del ultimo despacho (Hugo, 06-11).
 * Reglas de Hugo (04-nov-2026):
 * - Sin anuladas ni guias de transporte de bins (las de Multi X las agrega el
 *   a mano, porque las verifica con otras fuentes).
 * - Valores siempre netos.
 * - El periodo lo elige el a mano (no despacha siempre los mismos dias).
 * - Cermaq va en dos columnas, zona SUR y zona NORTE, con un solo periodo
 *   (cada quincena envia ambas zonas).
 */

export const EMPRESAS_REPORTE = ["CERQ", "MTX", "YDR"] as const;
export type EmpresaReporte = (typeof EMPRESAS_REPORTE)[number];

export const NOMBRE_EMPRESA_REPORTE: Record<EmpresaReporte, string> = {
  CERQ: "Cermaq",
  MTX: "Multiexport",
  YDR: "Yadran",
};

export type Zona = "SUR" | "NORTE";

/** Centros de Cermaq en zona norte (sin tildes ni signos). El resto es sur. */
const CERMAQ_NORTE = ["JACAFF", "ESTERO CONCHE", "ALDUNATE"];

const sinSignos = (t: string) =>
  t.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

export function zonaCermaq(centro: string): Zona {
  return CERMAQ_NORTE.includes(sinSignos(centro)) ? "NORTE" : "SUR";
}

export interface GuiaReporte {
  dteId: number;
  folio: number;
  /** yyyy-mm-dd */
  fecha: string;
  /** Nombre del centro ya unificado ("Churrecue Base" y "CHURRECUE BASE" son uno). */
  centro: string;
  neto: number;
  zona: Zona | null;
}

export interface LineaReporte {
  dteId: number;
  linea: number;
  codigo: string;
  producto: string;
  cantidad: number;
  precio: number;
}

/** Desde esta fecha hay guias sincronizadas. */
const DESDE_SIEMPRE = "2026-01-01";

async function clienteDe(empresa: EmpresaReporte): Promise<number | null> {
  const porCliente = await empresasPorCliente();
  for (const [cliente, codigo] of porCliente) if (codigo === empresa) return cliente;
  return null;
}

/** Guias del periodo; sinHoy = Relbase no respondio y pueden faltar las emitidas hoy. */
export interface GuiasDelPeriodo {
  guias: GuiaReporte[];
  sinHoy: boolean;
}

type FilaGuia = { dte_id: number; folio: number; fecha: string; contacto: string | null; monto_neto: number };

const esCodigoBins = (codigo: string | null) => (codigo ?? "").toUpperCase().startsWith("O-TB-");

/** Guias de hoy de la empresa que la sincronizacion todavia no trajo, sin anuladas ni bins. */
async function deHoy(cliente: number): Promise<FilaGuia[]> {
  const { guias } = await guiasNuevasDeHoy();
  return guias
    .filter((g) => g.customer_id === cliente && g.sii_status !== "cancel" && !esBins(g.contact))
    .filter((g) => !lineasDeHoy(g.id).some((l) => esCodigoBins(l.codigo)))
    .map((g) => ({ dte_id: g.id, folio: g.folio, fecha: g.start_date, contacto: g.contact, monto_neto: g.amount_neto }));
}

/**
 * Guias validas de la empresa entre dos fechas (incluidas), sin anuladas ni
 * bins. Las bins se reconocen por el contacto o por un producto O-TB-.
 * Si el periodo llega a hoy, suma lo emitido hoy leido de Relbase.
 */
export async function guiasDeEmpresa(empresa: EmpresaReporte, desde = DESDE_SIEMPRE, hasta = "2999-12-31"): Promise<GuiasDelPeriodo> {
  const cliente = await clienteDe(empresa);
  if (cliente == null) return { guias: [], sinHoy: false };
  const supabase = getSupabaseServiceClient();
  const hoy = hoyChile();
  const incluyeHoy = desde <= hoy && hoy <= hasta;
  const [filas, hoyLeido] = await Promise.all([
    traerTodasLasFilas((d, h) =>
      supabase
        .from("ventas_guias")
        .select("dte_id, folio, fecha, contacto, monto_neto")
        .eq("customer_id", cliente)
        .eq("anulada", false)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("dte_id")
        .range(d, h)
    ),
    incluyeHoy
      ? deHoy(cliente).catch((err) => {
          console.error("Reportes: no se pudieron leer de Relbase las guias de hoy", err);
          return null;
        })
      : Promise.resolve([] as FilaGuia[]),
  ]);
  const candidatas = filas.filter((g) => !esBins(g.contacto));

  // Guias con un producto de transporte de bins aunque el contacto sea un centro.
  const binsPorCodigo = new Set<number>();
  for (const ids of dividirEnLotes(candidatas.map((g) => g.dte_id), 300)) {
    const { data, error } = await supabase.from("ventas_lineas").select("dte_id").in("dte_id", ids).ilike("codigo", "O-TB-%");
    if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`);
    for (const l of data ?? []) binsPorCodigo.add(Number(l.dte_id));
  }
  const validas: FilaGuia[] = [...candidatas.filter((g) => !binsPorCodigo.has(Number(g.dte_id))), ...(hoyLeido ?? [])];

  const conteo = new Map<string, number>();
  for (const g of validas) {
    const c = (g.contacto ?? "").trim() || "SIN CENTRO";
    conteo.set(c, (conteo.get(c) ?? 0) + 1);
  }
  const nombreDe = unificarCentros([...conteo].map(([nombre, guias]) => ({ nombre, guias })));

  const guias = validas.map((g) => {
    const original = (g.contacto ?? "").trim() || "SIN CENTRO";
    const centro = nombreCompleto(nombreDe.get(original) ?? original);
    return {
      dteId: Number(g.dte_id),
      folio: Number(g.folio),
      fecha: String(g.fecha),
      centro,
      neto: Math.round(Number(g.monto_neto) || 0),
      zona: empresa === "CERQ" ? zonaCermaq(centro) : null,
    };
  });
  return { guias, sinHoy: hoyLeido == null };
}

/** "P Victoria" -> "PUNTA VICTORIA", "OF. MUELLE UCO" -> "OFICINA MUELLE UCO" (como escribe Hugo los reportes). */
function nombreCompleto(nombre: string): string {
  return nombre
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/^P\.? /, "PUNTA ")
    .replace(/^OF\.? /, "OFICINA ")
    .replace(/^BASE CHURRECUE$/, "CHURRECUE BASE");
}

/** Productos de las guias dadas (detalle de Multi X). */
export async function lineasDeGuias(dteIds: number[]): Promise<LineaReporte[]> {
  const supabase = getSupabaseServiceClient();
  const lotes = await Promise.all(
    dividirEnLotes(dteIds, 150).map((ids) =>
      traerTodasLasFilas((d, h) =>
        supabase
          .from("ventas_lineas")
          .select("dte_id, linea, codigo, nombre, cantidad, precio")
          .in("dte_id", ids)
          .order("dte_id")
          .order("linea")
          .range(d, h)
      )
    )
  );
  const sincronizadas = lotes.flat().map((l) => ({
    dteId: Number(l.dte_id),
    linea: Number(l.linea),
    codigo: l.codigo ?? "",
    producto: l.nombre ?? "",
    cantidad: Number(l.cantidad),
    precio: Number(l.precio),
  }));
  // Las de hoy aun no estan en Supabase: sus productos quedaron leidos de Relbase en guiasDeEmpresa.
  const conLineas = new Set(sincronizadas.map((l) => l.dteId));
  const deHoyLeidas = dteIds
    .filter((id) => !conLineas.has(id))
    .flatMap((id) =>
      lineasDeHoy(id).map((l, i) => ({
        dteId: id,
        linea: i + 1,
        codigo: l.codigo ?? "",
        producto: l.nombre ?? "",
        cantidad: l.cantidad,
        precio: l.precio,
      }))
    );
  return [...sincronizadas, ...deHoyLeidas];
}

/** Guias sin productos cargados todavia (la sincronizacion los trae de a poco). */
export async function guiasSinDetalle(dteIds: number[]): Promise<number[]> {
  const supabase = getSupabaseServiceClient();
  const faltan: number[] = [];
  for (const ids of dividirEnLotes(dteIds, 300)) {
    const { data } = await supabase.from("ventas_guias").select("folio").in("dte_id", ids).eq("lineas_cargadas", false);
    for (const g of data ?? []) faltan.push(Number(g.folio));
  }
  return faltan;
}

/** Periodo valido yyyy-mm-dd..yyyy-mm-dd, o null. */
export function rango(desde: string, hasta: string): { desde: string; hasta: string } | null {
  const ok = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t);
  if (!ok(desde) || !ok(hasta)) return null;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

export const enRango = (fecha: string, r: { desde: string; hasta: string } | null) => r != null && fecha >= r.desde && fecha <= r.hasta;
