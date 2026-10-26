import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";

/** Guias emitidas desde "Guia manual" (tabla guias_manuales), para el Historial. */
export interface GuiaManualHistorial {
  id: string;
  fecha: string;
  folio: string | null;
  dteId: number | null;
  cliente: string | null;
  neto: number;
  usuario: string | null;
  estado: "emitiendo" | "emitida" | "error";
  error: string | null;
}

export const GUIAS_MANUALES_A_MOSTRAR = 50;

/**
 * Las ultimas guias manuales que cumplen los filtros del Historial (texto =
 * folio o cliente; fechas por dia de emision). Un operador ve solo las suyas.
 */
export async function obtenerGuiasManuales(filtros: { texto?: string; desde?: string; hasta?: string; usuarioId?: string }): Promise<GuiaManualHistorial[]> {
  // Mismo cuidado que el historial de corridas: el texto entra a un or(...ilike...).
  const texto = (filtros.texto ?? "").trim().replace(/[^\p{L}\p{N}\s.\-_/]/gu, "").slice(0, 60).trim();
  let consulta = getSupabaseServiceClient()
    .from("guias_manuales")
    .select("id, created_at, folio, dte_id, cliente_nombre, monto_neto, usuario, estado, mensaje_error")
    .order("created_at", { ascending: false })
    .limit(GUIAS_MANUALES_A_MOSTRAR);
  if (texto) consulta = consulta.or(`folio.ilike.%${texto}%,cliente_nombre.ilike.%${texto}%`);
  if (filtros.desde) consulta = consulta.gte("created_at", `${filtros.desde}T00:00:00`);
  if (filtros.hasta) consulta = consulta.lte("created_at", `${filtros.hasta}T23:59:59`);
  if (filtros.usuarioId) consulta = consulta.eq("usuario_id", filtros.usuarioId);
  const { data } = await consulta;
  return (data ?? []).map((g) => ({
    id: g.id,
    fecha: g.created_at,
    folio: g.folio,
    dteId: g.dte_id != null ? Number(g.dte_id) : null,
    cliente: g.cliente_nombre,
    neto: Number(g.monto_neto),
    usuario: g.usuario,
    estado: g.estado as GuiaManualHistorial["estado"],
    error: g.mensaje_error,
  }));
}
