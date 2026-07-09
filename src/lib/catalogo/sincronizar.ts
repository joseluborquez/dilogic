import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
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

  const porCodigo = new Map<string, { id: number; precio: number }>();
  let totalPages = startPage; // se corrige con la respuesta de la primera pagina del lote

  for (let page = startPage; page < startPage + cantidadPaginas; page++) {
    const pagina = await listarProductosPagina(credenciales, page);
    totalPages = pagina.meta.total_pages;
    if (page > totalPages) break;
    for (const p of pagina.data.products) {
      if (!p.code) continue;
      porCodigo.set(p.code, { id: p.id, precio: Number(p.price) });
    }
  }

  const { data: nuestroCatalogo, error } = await supabase
    .from("productos_catalogo")
    .select("id, sku");
  if (error) throw error;

  const actualizaciones = (nuestroCatalogo ?? [])
    .map((row) => {
      const match = porCodigo.get(row.sku);
      return match ? { id: row.id, product_id_relbase: match.id, precio: match.precio } : null;
    })
    .filter((u): u is { id: string; product_id_relbase: number; precio: number } => u !== null);

  await Promise.all(
    actualizaciones.map((u) =>
      supabase
        .from("productos_catalogo")
        .update({
          product_id_relbase: u.product_id_relbase,
          precio: u.precio,
          ultima_sincronizacion: new Date().toISOString(),
        })
        .eq("id", u.id)
    )
  );

  return {
    totalPages,
    hastaPagina: Math.min(startPage + cantidadPaginas - 1, totalPages),
    actualizados: actualizaciones.length,
  };
}

/**
 * Ultimo paso: para los SKUs que sigan sin product_id_relbase tras recorrer
 * todas las paginas (hueco de paginacion conocido en Relbase, 09-jul-2026),
 * busca cada uno directo por codigo. Son pocos (~10), asi que esto es rapido
 * y no necesita dividirse en lotes.
 */
export async function sincronizarPendientesDirecto(): Promise<ResumenSincronizacion> {
  const credenciales = await obtenerCredencialesCompartidas();
  const supabase = getSupabaseServiceClient();

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id, codigo_interno")
    .eq("activo", true);
  if (errEmpresas || !empresas) throw new Error("No hay empresas activas configuradas.");

  const { data: nuestroCatalogo, error } = await supabase
    .from("productos_catalogo")
    .select("id, sku, empresa_id, product_id_relbase");
  if (error) throw error;

  const codigoPorEmpresaId = new Map(empresas.map((e) => [e.id, e.codigo_interno]));
  const pendientes = (nuestroCatalogo ?? []).filter((r) => r.product_id_relbase == null);
  const sinMatchFinal: { sku: string; codigoEmpresa: string }[] = [];

  for (const p of pendientes) {
    const producto = await buscarProductoPorCodigo(credenciales, p.sku);
    const codigoEmpresa = codigoPorEmpresaId.get(p.empresa_id) ?? "?";
    if (producto) {
      await supabase
        .from("productos_catalogo")
        .update({
          product_id_relbase: producto.id,
          precio: Number(producto.price),
          ultima_sincronizacion: new Date().toISOString(),
        })
        .eq("id", p.id);
    } else {
      sinMatchFinal.push({ sku: p.sku, codigoEmpresa });
    }
  }

  const { data: catalogoFinal } = await supabase.from("productos_catalogo").select("id, empresa_id");

  const porEmpresa: ResumenEmpresa[] = empresas.map((e) => {
    const filasEmpresa = (catalogoFinal ?? []).filter((r) => r.empresa_id === e.id);
    const sinMatch = sinMatchFinal.filter((s) => s.codigoEmpresa === e.codigo_interno).map((s) => s.sku);
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
  };
}
