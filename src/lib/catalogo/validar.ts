import "server-only";

import type { FilaPedido } from "@/lib/excel/types";
import catalogoLocal from "./catalogo-seed.json";

export type EstadoFila = "valido" | "advertencia" | "error";

export interface FilaValidada extends FilaPedido {
  estado: EstadoFila;
  mensajes: string[];
  descripcionProducto: string | null;
  // Nota corta de unidad/empaque (ej. "1 lt. Bot."), atributo "description"
  // de Relbase — no confundir con descripcionProducto (el nombre).
  descripcionUnidad: string | null;
  productIdRelbase: number | null;
  precio: number | null;
}

export interface ProductoCatalogoResumen {
  descripcion: string | null;
  descripcionUnidad: string | null;
  productIdRelbase: number | null;
  precio: number | null;
  familia: string | null;
}

export interface CatalogoEmpresa {
  mapa: Map<string, ProductoCatalogoResumen>;
  fuente: "supabase" | "local";
}

/**
 * Los SKUs de Dilogic siguen el patron EMPRESA_CATEGORIA_NUMERO (ej.
 * CERQ_AB_017 -> "AB" = Abarrotes, CC = Carne Congelada, FV = Fruta y
 * Verdura). Se usa como respaldo cuando el catalogo aun no tiene `familia`
 * poblada para un SKU (ej. una empresa nueva recien cargada).
 */
function derivarFamiliaDeSku(sku: string): string | null {
  const partes = sku.split("_");
  return partes.length === 3 ? partes[1] : null;
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

    // Paginado: PostgREST corta en max-rows, y un catalogo truncado marcaria
    // como "codigo inexistente" productos que si estan cargados.
    const { traerTodasLasFilas } = await import("@/lib/supabase/paginar");
    const productos = await traerTodasLasFilas((desde, hasta) =>
      supabase
        .from("productos_catalogo")
        .select("sku, descripcion, descripcion_relbase, product_id_relbase, precio, familia")
        .eq("empresa_id", empresa.id)
        .order("sku")
        .range(desde, hasta)
    );

    const mapa = new Map<string, ProductoCatalogoResumen>();
    for (const p of productos) {
      mapa.set(p.sku, {
        descripcion: p.descripcion,
        descripcionUnidad: p.descripcion_relbase,
        productIdRelbase: p.product_id_relbase,
        precio: p.precio,
        familia: p.familia ?? derivarFamiliaDeSku(p.sku),
      });
    }
    return { mapa, fuente: "supabase" };
  }

  const productosLocal = (catalogoLocal as Record<string, { sku: string; descripcion: string | null }[]>)[
    codigoInterno
  ] ?? [];
  const mapa = new Map<string, ProductoCatalogoResumen>();
  for (const p of productosLocal) {
    mapa.set(p.sku, {
      descripcion: p.descripcion,
      descripcionUnidad: null,
      productIdRelbase: null,
      precio: null,
      familia: derivarFamiliaDeSku(p.sku),
    });
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

    // La clave incluye el centro: un mismo codigo pedido por varios centros
    // (formato matriz) es normal, no un duplicado. Solo es repetido si el
    // mismo codigo aparece dos veces para el mismo centro (misma guia).
    const claveVisto = `${fila.codigo}::${fila.centro ?? ""}`;
    if (vistos.has(claveVisto)) {
      if (estado !== "error") estado = "advertencia";
      mensajes.push("Codigo repetido en el archivo.");
    }
    vistos.add(claveVisto);

    return {
      ...fila,
      categoria: producto?.familia ?? fila.categoria,
      estado,
      mensajes,
      descripcionProducto: producto?.descripcion ?? null,
      descripcionUnidad: producto?.descripcionUnidad ?? null,
      productIdRelbase: producto?.productIdRelbase ?? null,
      precio: producto?.precio ?? null,
    };
  });
}
