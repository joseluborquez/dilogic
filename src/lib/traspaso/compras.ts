import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { listarComprasProveedor, obtenerCompra } from "@/lib/relbase/client";
import type { FacturaLeida, LineaFactura } from "./leer-factura";

/**
 * Facturas de proveedor leidas desde los documentos recibidos en Relbase, en
 * vez del PDF. Relbase a veces si trae los productos de una compra aunque
 * is_load_xml diga false (Ovando, folio 49379, 27-oct-2026): se mira la lista
 * de productos, no esa marca. Sus precios vienen netos.
 */

/** Cuantos dias atras se ofrecen las facturas no traspasadas. */
const DIAS_RECIENTES = 60;

export interface CompraRecibida {
  id: number;
  folio: string;
  fecha: string;
  neto: number;
  total: number;
  /** Lineas con producto en Relbase (0: hay que subir el PDF). */
  lineas: number;
  traspasada: string | null;
}

interface ProductoCompra {
  description?: string | null;
  code?: string | null;
  quantity?: number | null;
  price?: number | null;
  discount?: number | null;
}

/**
 * "JAMON PIERNA X 150 G - JAMON PIERNA X 150 GR." -> la version mas completa:
 * algunos proveedores repiten el nombre despues de " - ".
 */
function limpiarDescripcion(texto: string): string {
  const s = texto.replace(/\s+/g, " ").trim();
  const [a, b, ...resto] = s.split(" - ");
  if (b && resto.length === 0 && b.slice(0, 10).toUpperCase() === a.slice(0, 10).toUpperCase()) {
    return b.length > a.length ? b : a;
  }
  return s;
}

/** Convierte una compra de Relbase al mismo formato que una factura leida del PDF. */
export async function leerCompraRelbase(id: number): Promise<FacturaLeida & { proveedorRut: string | null }> {
  const c = (await obtenerCompra(id)) as Record<string, unknown> & { products?: ProductoCompra[] };
  const productos = c.products ?? [];
  const lineas: LineaFactura[] = productos.map((p) => {
    const cantidad = Number(p.quantity ?? 0);
    const precio = Number(p.price ?? 0);
    return {
      codigo: String(p.code ?? ""),
      nombre: limpiarDescripcion(String(p.description ?? "")),
      cantidad,
      precio,
      total: Math.round(cantidad * precio * (1 - Number(p.discount ?? 0) / 100) * 100) / 100,
    };
  });
  // armarTraspaso reparte el neto de la factura en proporcion al total de cada
  // linea sobre el Sub-Total: aqui las lineas ya son netas, asi que el
  // Sub-Total es su suma.
  const subtotal = lineas.reduce((n, l) => n + l.total, 0);
  const neto = Number(c.amount_neto ?? 0);
  const exento = Number(c.amount_exempt ?? 0);
  const problemas: string[] = [];
  if (lineas.length === 0) {
    problemas.push("Relbase no tiene los productos de esta factura (el proveedor no envió el detalle): súbela en PDF.");
  } else if (Math.abs(subtotal - (neto + exento)) > lineas.length) {
    // Tolerancia: un peso por linea, por los precios con decimales.
    problemas.push(
      `Los productos en Relbase suman $${Math.round(subtotal).toLocaleString("es-CL")} y el neto es $${(neto + exento).toLocaleString("es-CL")}.`
    );
  }
  return {
    folio: String(c.folio ?? ""),
    rutEmisor: c.provider_rut ? String(c.provider_rut) : null,
    proveedorRut: c.provider_rut ? String(c.provider_rut) : null,
    fecha: c.start_date ? String(c.start_date) : null,
    subtotal,
    neto,
    iva: Number(c.amount_iva ?? 0),
    total: Number(c.amount_total ?? 0),
    lineas,
    problemas,
  };
}

/**
 * Facturas recibidas de un proveedor en los ultimos dias, para elegirlas en
 * Traspaso de costos. Solo las no traspasadas se abren para ver si traen
 * productos (una llamada por factura).
 */
export async function comprasRecibidas(rut: string): Promise<CompraRecibida[]> {
  const desde = new Date(Date.now() - DIAS_RECIENTES * 864e5).toISOString().slice(0, 10);
  const [compras, { data: hechas }] = await Promise.all([
    listarComprasProveedor(rut),
    getSupabaseServiceClient().from("traspasos_factura").select("folio, created_at").eq("proveedor_rut", rut),
  ]);
  const traspasadas = new Map((hechas ?? []).map((h) => [h.folio, h.created_at]));
  const recientes = compras.filter((c) => c.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha));

  const resultado: CompraRecibida[] = [];
  for (const c of recientes) {
    const traspasada = traspasadas.get(String(c.folio)) ?? null;
    let lineas = 0;
    if (!traspasada) {
      const detalle = (await obtenerCompra(c.id)) as { products?: unknown[] };
      lineas = detalle.products?.length ?? 0;
    }
    resultado.push({ id: c.id, folio: String(c.folio), fecha: c.fecha, neto: c.neto, total: c.total, lineas, traspasada });
  }
  return resultado;
}
