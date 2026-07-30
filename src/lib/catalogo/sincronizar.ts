import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { enLotes } from "@/lib/util/lotes";
import { decryptToken } from "@/lib/crypto/tokens";
import {
  buscarProductoPorCodigo,
  listarProductosPagina,
} from "@/lib/relbase/client";
import type { RelbaseCredenciales } from "@/lib/relbase/types";

export interface ResumenEmpresa {
  codigoInterno: string;
  total: number;
  conMatch: number;
  sinMatch: string[];
}

export interface ResumenSincronizacion {
  totalProductosRelbase: number;
  porEmpresa: ResumenEmpresa[];
  /** Indice del catalogo desde donde debe continuar la proxima llamada. */
  siguienteIndice: number;
  quedanMas: boolean;
}

export interface ResultadoLote {
  totalPages: number;
  hastaPagina: number;
  actualizados: number;
}

/**
 * Todas las empresas comparten las mismas credenciales Relbase (confirmado
 * 09-jul-2026), asi que basta con las de la primera empresa activa para
 * traer el catalogo completo.
 */
async function obtenerCredencialesCompartidas(): Promise<RelbaseCredenciales> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id")
    .eq("activo", true)
    .limit(1);
  if (errEmpresas || !empresas || empresas.length === 0) {
    throw new Error("No hay empresas activas configuradas.");
  }

  const { data: cred, error: errCred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", empresas[0].id)
    .single();
  if (errCred || !cred) {
    throw new Error("No hay credenciales de Relbase configuradas.");
  }

  return {
    tokenEmpresa: decryptToken(cred.token_empresa),
    tokenUsuarioIntegrador: decryptToken(cred.token_usuario_integrador),
  };
}

/**
 * Sincroniza un lote de paginas de Relbase (solo lectura hacia Relbase) y
 * actualiza los matches encontrados en productos_catalogo. Disenado para
 * ser llamado repetidamente desde el cliente (paginas [startPage,
 * startPage + cantidadPaginas - 1]) en vez de una sola invocacion larga,
 * porque el sync completo mide ~2.6 min en la practica (163 paginas) y
 * excederia el limite de duracion de una funcion serverless en Vercel.
 */
export async function sincronizarLotePaginas(
  startPage: number,
  cantidadPaginas: number
): Promise<ResultadoLote> {
  const credenciales = await obtenerCredencialesCompartidas();
  const supabase = getSupabaseServiceClient();

  const porCodigo = new Map<string, { id: number; precio: number; descripcionRelbase: string | null }>();
  let totalPages = startPage; // se corrige con la respuesta de la primera pagina del lote

  for (let page = startPage; page < startPage + cantidadPaginas; page++) {
    const pagina = await listarProductosPagina(credenciales, page);
    totalPages = pagina.meta.total_pages;
    if (page > totalPages) break;
    for (const p of pagina.data.products) {
      if (!p.code) continue;
      // Sin Number.isFinite, un producto sin precio en Relbase daba NaN, que
      // se serializa como null y borraba en silencio el precio guardado.
      const precio = Number(p.price);
      if (!Number.isFinite(precio)) continue;
      porCodigo.set(p.code, { id: p.id, precio, descripcionRelbase: p.description ?? null });
    }
  }

  const nuestroCatalogo = await traerTodasLasFilas((desde, hasta) =>
    supabase.from("productos_catalogo").select("id, sku").order("sku").order("id", { ascending: true }).range(desde, hasta)
  );

  const actualizaciones = nuestroCatalogo
    .map((row) => {
      const match = porCodigo.get(row.sku);
      return match
        ? {
            id: row.id,
            product_id_relbase: match.id,
            precio: match.precio,
            descripcionRelbase: match.descripcionRelbase,
          }
        : null;
    })
    .filter(
      (
        u
      ): u is {
        id: string;
        product_id_relbase: number;
        precio: number;
        descripcionRelbase: string | null;
      } => u !== null
    );

  // De a 10: un Promise.all sobre la lista completa abriria cientos de
  // conexiones simultaneas a Supabase desde un solo lambda, y la lista crece
  // con cada empresa nueva.
  await enLotes(actualizaciones, 10, async (u) => {
    await supabase
      .from("productos_catalogo")
      .update({
        product_id_relbase: u.product_id_relbase,
        precio: u.precio,
        descripcion_relbase: u.descripcionRelbase,
        ultima_sincronizacion: new Date().toISOString(),
      })
      .eq("id", u.id);
  });

  return {
    totalPages,
    hastaPagina: Math.min(startPage + cantidadPaginas - 1, totalPages),
    actualizados: actualizaciones.length,
  };
}

/**
 * Cuantos pendientes resuelve cada llamada. Cada uno es una consulta a Relbase
 * en serie (~0,5 s), asi que el lote acota la duracion de la funcion.
 *
 * Antes se procesaban todos de una vez, apoyandose en que eran ~10: eso valia
 * cuando las empresas se cargaban a mano y sus productos ya existian en
 * Relbase. Una empresa creada desde la app puede llegar con 250 pendientes de
 * golpe, y ahi la funcion se pasaba del tiempo maximo.
 */
const PENDIENTES_POR_LOTE = 40;

export async function sincronizarPendientesDirecto(
  desdeIndice = 0
): Promise<ResumenSincronizacion> {
  const credenciales = await obtenerCredencialesCompartidas();
  const supabase = getSupabaseServiceClient();

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id, codigo_interno")
    .eq("activo", true);
  if (errEmpresas || !empresas) throw new Error("No hay empresas activas configuradas.");

  // Paginado: PostgREST corta en max-rows. Con ~800 SKUs y tres empresas la
  // consulta entera cabia, pero cada empresa nueva suma ~250 y los que
  // quedaran fuera nunca se sincronizarian (ni se notaria).
  const nuestroCatalogo = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, sku, empresa_id, product_id_relbase")
      .order("sku")
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const codigoPorEmpresaId = new Map(empresas.map((e) => [e.id, e.codigo_interno]));
  const sinMatchFinal: { sku: string; codigoEmpresa: string }[] = [];

  // Se avanza por indice sobre el catalogo COMPLETO (orden estable), no sobre
  // la lista filtrada de pendientes: un SKU que no existe en Relbase sigue
  // pendiente despues de intentarlo, y recorrer "los primeros N pendientes"
  // volveria a intentar los mismos para siempre.
  const pendientes: typeof nuestroCatalogo = [];
  let indice = Math.max(0, desdeIndice);
  while (indice < nuestroCatalogo.length && pendientes.length < PENDIENTES_POR_LOTE) {
    const fila = nuestroCatalogo[indice];
    if (fila.product_id_relbase == null) pendientes.push(fila);
    indice += 1;
  }

  for (const p of pendientes) {
    const producto = await buscarProductoPorCodigo(credenciales, p.sku);
    const codigoEmpresa = codigoPorEmpresaId.get(p.empresa_id) ?? "?";
    if (producto) {
      await supabase
        .from("productos_catalogo")
        .update({
          product_id_relbase: producto.id,
          precio: Number(producto.price),
          descripcion_relbase: producto.description ?? null,
          ultima_sincronizacion: new Date().toISOString(),
        })
        .eq("id", p.id);
    } else {
      sinMatchFinal.push({ sku: p.sku, codigoEmpresa });
    }
  }

  // El resumen se calcula desde el estado real de la base y no desde lo
  // intentado en esta llamada: al procesar por lotes, `sinMatchFinal` solo
  // conoce el ultimo lote y el total quedaria subestimado.
  const catalogoFinal = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, empresa_id, sku, product_id_relbase")
      .order("id")
      .range(desde, hasta)
  );

  const porEmpresa: ResumenEmpresa[] = empresas.map((e) => {
    const filasEmpresa = catalogoFinal.filter((r) => r.empresa_id === e.id);
    const sinMatch = filasEmpresa.filter((r) => r.product_id_relbase == null).map((r) => r.sku);
    return {
      codigoInterno: e.codigo_interno,
      total: filasEmpresa.length,
      conMatch: filasEmpresa.length - sinMatch.length,
      sinMatch,
    };
  });

  return {
    totalProductosRelbase: 0, // no aplica en este paso puntual
    porEmpresa,
    // Desde donde sigue el proximo lote. Siempre avanza, asi que el ciclo del
    // cliente termina aunque ningun SKU del lote se haya podido resolver.
    siguienteIndice: indice,
    quedanMas: indice < nuestroCatalogo.length,
  };
}
