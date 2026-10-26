import "server-only";

import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { agregadoPeriodo, hoyChile, TAG_VENTAS } from "@/lib/ventas/indicadores";
import { inicioMesesAtras } from "@/lib/ventas/sincronizar";
import type { ProductoGuia } from "./resolver";

/** Los precios de referencia salen de las guias desde que empezo la automatizacion. */
const INICIO_AUTOMATIZACION = "2026-07-01";
const MESES_DE_PRECIO = 3;

export function desdePrecios(): string {
  const tresMeses = inicioMesesAtras(MESES_DE_PRECIO);
  return tresMeses > INICIO_AUTOMATIZACION ? tresMeses : INICIO_AUTOMATIZACION;
}

/**
 * Productos vigentes de Cermaq, Multiexport y Yadran con el precio que se usa
 * en la guia manual: el ultimo cobrado en guias de los ultimos 3 meses, y si
 * no se vendio en ese tiempo, el del catalogo (Relbase). `agregar` permite
 * usarla fuera de Next (scripts) con calcularAgregado, sin la cache.
 */
export async function cargarProductos(
  desde: string,
  hasta: string,
  agregar: typeof agregadoPeriodo = agregadoPeriodo
): Promise<ProductoGuia[]> {
  const [catalogo, ventas] = await Promise.all([
    traerTodasLasFilas((d, h) =>
      getSupabaseServiceClient()
        .from("productos_catalogo")
        .select("sku, descripcion, nombre_relbase, familia, precio, product_id_relbase")
        .eq("activo", true)
        .not("product_id_relbase", "is", null)
        .order("sku")
        .order("id", { ascending: true })
        .range(d, h)
    ),
    agregar(desde, hasta),
  ]);
  const precioVendido = new Map(ventas.productos.map((p) => [p.codigo, p.ultimoPrecio]));

  return catalogo
    .filter((p) => /^(CERQ|MTX|YDR)_[A-Z]+_\d+$/.test(p.sku))
    .map((p) => {
      const vendido = precioVendido.get(p.sku) ?? null;
      const catalogoPrecio = p.precio != null && Number(p.precio) > 1 ? Math.round(Number(p.precio)) : null;
      return {
        productId: Number(p.product_id_relbase),
        codigo: p.sku,
        nombre: p.nombre_relbase ?? p.descripcion ?? p.sku,
        empresa: p.sku.split("_")[0],
        familia: p.familia,
        precio: vendido ?? catalogoPrecio,
        origenPrecio: vendido != null ? ("ventas" as const) : catalogoPrecio != null ? ("catalogo" as const) : null,
      };
    });
}

const productosCacheados = unstable_cache((desde: string, hasta: string) => cargarProductos(desde, hasta), ["guia-manual-productos-v1"], {
  tags: [TAG_VENTAS],
  revalidate: 3600,
});

export function productosParaGuia(): Promise<ProductoGuia[]> {
  return productosCacheados(desdePrecios(), hoyChile());
}

/**
 * Productos que Hugo creo en Relbase fuera del catalogo oficial (para
 * clientes esporadicos: CR-CK-119565, TTF_005...), sacados de las guias ya
 * emitidas: son los que de verdad se usan. Precio: el ultimo cobrado en una
 * guia valida. Quedan fuera los codigos antiguos de las tres empresas
 * (CERQ_109: version vieja de un producto oficial), AMS (empresa antigua),
 * los anulados (ANU-), el comodin VIVERES VARIOS, el generico y el
 * transporte de bins.
 */
export async function cargarProductosCreados(): Promise<ProductoGuia[]> {
  const lineas = await traerTodasLasFilas((d, h) =>
    getSupabaseServiceClient()
      .from("ventas_lineas")
      .select("codigo, nombre, product_id, precio, ventas_guias!inner(fecha, anulada)")
      .eq("ventas_guias.anulada", false)
      .not("codigo", "is", null)
      .not("product_id", "is", null)
      .not("codigo", "like", "CERQ%")
      .not("codigo", "like", "MTX%")
      .not("codigo", "like", "YDR%")
      .not("codigo", "ilike", "%AMS%")
      .not("codigo", "ilike", "O-PG-%")
      .not("codigo", "ilike", "O-TB-%")
      // ANU-: anulados o renombrados. O-VV: "VIVERES VARIOS", un comodin que calzaria con todo.
      .not("codigo", "ilike", "ANU-%")
      .not("codigo", "ilike", "O-VV-%")
      .order("dte_id")
      .order("linea")
      .range(d, h)
  );
  const porCodigo = new Map<string, { productId: number; nombre: string; fecha: string; precio: number | null }>();
  for (const l of lineas as unknown as { codigo: string; nombre: string | null; product_id: number; precio: number; ventas_guias: { fecha: string } }[]) {
    const fecha = l.ventas_guias.fecha;
    const precio = Math.round(Number(l.precio));
    const actual = porCodigo.get(l.codigo);
    if (!actual || fecha >= actual.fecha) {
      porCodigo.set(l.codigo, {
        productId: Number(l.product_id),
        nombre: l.nombre ?? l.codigo,
        fecha,
        // Un precio de $1 es una guia "sin valor": se conserva el anterior.
        precio: precio > 1 ? precio : (actual?.precio ?? null),
      });
    }
  }
  return [...porCodigo.entries()].map(([codigo, p]) => ({
    productId: p.productId,
    codigo,
    nombre: p.nombre,
    empresa: null,
    familia: null,
    precio: p.precio,
    origenPrecio: p.precio != null ? ("ventas" as const) : null,
  }));
}

export const productosCreados = unstable_cache(cargarProductosCreados, ["guia-manual-creados-v1"], {
  tags: [TAG_VENTAS],
  revalidate: 3600,
});
