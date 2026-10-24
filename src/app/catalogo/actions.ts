"use server";

import {
  sincronizarLotePaginas,
  sincronizarPendientesDirecto,
  type ResultadoLote,
  type ResumenSincronizacion,
} from "@/lib/catalogo/sincronizar";

import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";
import { requerirAdmin } from "@/lib/auth/sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function sincronizarLoteAction(startPage: number): Promise<ResultadoLote> {
  await requerirAdmin();
  return sincronizarLotePaginas(startPage, PAGINAS_POR_LOTE);
}

export async function sincronizarPendientesAction(
  desdeIndice = 0
): Promise<ResumenSincronizacion> {
  await requerirAdmin();
  return sincronizarPendientesDirecto(desdeIndice);
}

/**
 * Saca un codigo de los pedidos sin borrarlo (el historial lo sigue
 * referenciando). La validacion y la generacion rechazan codigos inactivos.
 */
export async function desactivarCodigoAction(
  sku: string
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  await requerirAdmin();
  const { data, error } = await getSupabaseServiceClient()
    .from("productos_catalogo")
    .update({ activo: false })
    .eq("sku", sku)
    .select("id");
  if (error) return { ok: false, mensaje: "No se pudo desactivar el código." };
  if (!data || data.length === 0) return { ok: false, mensaje: "Ese código ya no está en el catálogo." };
  return { ok: true };
}
