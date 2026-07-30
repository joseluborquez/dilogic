"use server";

import {
  sincronizarLotePaginas,
  sincronizarPendientesDirecto,
  type ResultadoLote,
  type ResumenSincronizacion,
} from "@/lib/catalogo/sincronizar";

import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";

export async function sincronizarLoteAction(startPage: number): Promise<ResultadoLote> {
  return sincronizarLotePaginas(startPage, PAGINAS_POR_LOTE);
}

export async function sincronizarPendientesAction(
  desdeIndice = 0
): Promise<ResumenSincronizacion> {
  return sincronizarPendientesDirecto(desdeIndice);
}
