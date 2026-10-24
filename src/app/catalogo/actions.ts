"use server";

import {
  aplicarEstadoRelbase,
  cerrarRegistroSincronizacion,
  iniciarRegistroSincronizacion,
  sincronizarLotePaginas,
  sincronizarPendientesDirecto,
  type CodigoCambiado,
  type ResultadoEstado,
  type ResultadoLote,
  type ResumenSincronizacion,
} from "@/lib/catalogo/sincronizar";

import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";
import { requerirAdmin } from "@/lib/auth/sesion";

/**
 * El boton de Catalogo hace la sincronizacion en pasos (cada uno cabe holgado
 * en el limite de una funcion): iniciar, lotes de paginas, busqueda directa de
 * los no vistos, y finalizar, que aplica el estado de Relbase.
 */
export async function iniciarSincronizacionAction(): Promise<{ id: string; inicio: string }> {
  await requerirAdmin();
  return iniciarRegistroSincronizacion("manual");
}

export async function sincronizarLoteAction(startPage: number): Promise<ResultadoLote> {
  await requerirAdmin();
  return sincronizarLotePaginas(startPage, PAGINAS_POR_LOTE);
}

export async function sincronizarPendientesAction(
  desdeIndice: number,
  inicio: string
): Promise<ResumenSincronizacion> {
  await requerirAdmin();
  return sincronizarPendientesDirecto(desdeIndice, inicio);
}

export async function finalizarSincronizacionAction(
  id: string,
  inicio: string,
  acumulado: { actualizados: number; insertados: string[]; codigosCambiados: CodigoCambiado[] }
): Promise<ResultadoEstado> {
  await requerirAdmin();
  try {
    const estado = await aplicarEstadoRelbase(
      inicio,
      new Map(acumulado.codigosCambiados.map((c) => [c.sku, c.codigoRelbase]))
    );
    await cerrarRegistroSincronizacion(id, { resumen: { ...acumulado, ...estado } });
    return estado;
  } catch (err) {
    await cerrarRegistroSincronizacion(id, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function registrarErrorSincronizacionAction(id: string, mensaje: string): Promise<void> {
  await requerirAdmin();
  await cerrarRegistroSincronizacion(id, { error: mensaje });
}
