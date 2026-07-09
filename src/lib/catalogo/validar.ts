import "server-only";

import type { FilaPedido } from "@/lib/excel/types";
import catalogoLocal from "./catalogo-seed.json";

export type EstadoFila = "valido" | "advertencia" | "error";

export interface FilaValidada extends FilaPedido {
  estado: EstadoFila;
  mensajes: string[];
  descripcionProducto: string | null;
  productIdRelbase: number | null;
  precio: number | null;
}

export interface ProductoCatalogoResumen {
  descripcion: string | null;
  productIdRelbase: number | null;
  precio: number | null;
}

export interface CatalogoEmpresa {
  mapa: Map<string, ProductoCatalogoResumen>;
  fuente: "supabase" | "local";
}

function tieneSupabaseConfigurado(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Mientras no exista el proyecto Supabase, el catalogo se sirve desde
 * catalogo-seed.json (generado por scripts/generate-catalog-local-json.mjs a
 * partir de CODIGOS DILOGIC.xlsx). Cuando las credenciales de Supabase esten
 * configuradas, este mismo llamado debe reemplazarse por una consulta real a
 * productos_catalogo (join empresas por codigo_interno).
 */
export async function obtenerCatalogoEmpresa(codigoInterno: string): Promise<CatalogoEmpresa> {
  if (tieneSupabaseConfigurado()) {
    const { getSupabaseServiceClient } = await import("@/lib/supabase/server");
    const supabase = getSupabaseServiceClient();

    const { data: empresa, error: errorEmpresa } = await supabase
      .from("empresas")
      .select("id")
      .eq("codigo_interno", codigoInterno)
      .single();

    if (errorEmpresa || !empresa) {
      throw new Error(`Empresa no encontrada: ${codigoInterno}`);
    }

    const { data: productos, error: errorProductos } = await supabase
      .from("productos_catalogo")
      .select("sku, descripcion, product_id_relbase, precio")
      .eq("empresa_id", empresa.id);

    if (errorProductos) throw errorProductos;

    const mapa = new Map<string, ProductoCatalogoResumen>();
    for (const p of productos ?? []) {
      mapa.set(p.sku, {
        descripcion: p.descripcion,
        productIdRelbase: p.product_id_relbase,
        precio: p.precio,
      });
    }
    return { mapa, fuente: "supabase" };
  }

  const productosLocal = (catalogoLocal as Record<string, { sku: string; descripcion: string | null }[]>)[
    codigoInterno
  ] ?? [];
  const mapa = new Map<string, ProductoCatalogoResumen>();
  for (const p of productosLocal) {
    mapa.set(p.sku, { descripcion: p.descripcion, productIdRelbase: null, precio: null });
  }
  return { mapa, fuente: "local" };
}

export function validarFilas(filas: FilaPedido[], catalogo: CatalogoEmpresa["mapa"]): FilaValidada[] {
  const vistos = new Set<string>();

  return filas.map((fila) => {
    const mensajes: string[] = [];
    let estado: EstadoFila = "valido";
    const producto = catalogo.get(fila.codigo);

    if (!producto) {
      estado = "error";
      mensajes.push("El codigo no existe en el catalogo de esta empresa.");
    } else if (producto.productIdRelbase == null) {
      estado = "error";
      mensajes.push("Producto sin product_id de Relbase (falta sincronizar).");
    }

    if (vistos.has(fila.codigo)) {
      if (estado !== "error") estado = "advertencia";
      mensajes.push("Codigo repetido en el archivo.");
    }
    vistos.add(fila.codigo);

    return {
      ...fila,
      estado,
      mensajes,
      descripcionProducto: producto?.descripcion ?? null,
      productIdRelbase: producto?.productIdRelbase ?? null,
      precio: producto?.precio ?? null,
    };
  });
}
