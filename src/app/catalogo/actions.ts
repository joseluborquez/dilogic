"use server";

import {
  sincronizarLotePaginas,
  sincronizarPendientesDirecto,
  type ResultadoLote,
  type ResumenSincronizacion,
} from "@/lib/catalogo/sincronizar";

import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";
import { requerirAdmin } from "@/lib/auth/sesion";

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
