import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { obtenerDte } from "@/lib/relbase/client";
import type { RelbaseDteResumen } from "@/lib/relbase/types";
import type { SincronizacionVentas, VentaLinea } from "@/lib/supabase/types";
import { dividirEnLotes } from "@/lib/util/lotes";
import { clasificarCodigo } from "./clasificar";
import { recorrerGuiasDesde } from "./recorrer";

/** Detalles (GET /dtes/{id}) que se piden a la vez. */
const DETALLES_EN_PARALELO = 5;
/** La actualizacion diaria relee estos meses: una guia puede anularse semanas despues. */
export const MESES_A_RELEER = 3;

export interface ResumenSincronizacionVentas {
  guiasListadas: number;
  anuladas: number;
  /** Guias validas a las que se les trajo el detalle en esta corrida. */
  detallesCargados: number;
  /** Guias validas que quedaron sin detalle (se acabo el tiempo): siguen en la proxima. */
  detallesPendientes: number;
  segundos: number;
}

/** Primer dia del mes, `meses` meses atras, en hora de Chile (yyyy-mm-dd). */
export function inicioMesesAtras(meses: number, hoy = new Date()): string {
  const [anio, mes] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
  })
    .format(hoy)
    .split("-")
    .map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1 - meses, 1));
  return fecha.toISOString().slice(0, 10);
}

function filaGuia(g: RelbaseDteResumen) {
  // Sin lineas_cargadas: en un upsert, una guia ya cargada no debe volver a
  // false. Al insertar toma el default (false).
  return {
    dte_id: g.id,
    folio: Number(g.folio),
    fecha: g.start_date,
    sii_status: g.sii_status,
    customer_id: g.customer_id,
    contacto: g.contact,
    type_transfer: g.type_transfer,
    monto_neto: Number(g.amount_neto) || 0,
    monto_total: Number(g.amount_total) || 0,
    actualizado_en: new Date().toISOString(),
  };
}

async function cargarDetalle(dteId: number): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const detalle = await obtenerDte(dteId);
  const lineas: VentaLinea[] = (detalle.products ?? []).map((p, i) => {
    const cantidad = Number(p.quantity) || 0;
    const precio = Number(p.price) || 0;
    const descuento = p.discount == null ? null : Number(p.discount);
    const { empresa, familia } = clasificarCodigo(p.code, p.product_id);
    return {
      dte_id: dteId,
      linea: i + 1,
      product_id: p.product_id ?? null,
      codigo: p.code,
      nombre: p.name,
      empresa,
      familia,
      cantidad,
      precio,
      descuento,
      monto_neto: Math.round(cantidad * precio * (1 - (descuento ?? 0) / 100)),
    };
  });
  if (lineas.length > 0) {
    const { error } = await supabase.from("ventas_lineas").upsert(lineas, { onConflict: "dte_id,linea" });
    if (error) throw new Error(`No se pudieron guardar las líneas de la guía ${detalle.folio}: ${error.message}`);
  }
  const { error } = await supabase.from("ventas_guias").update({ lineas_cargadas: true }).eq("dte_id", dteId);
  if (error) throw new Error(`No se pudo marcar la guía ${detalle.folio}: ${error.message}`);
}

/**
 * Trae de Relbase las guias desde `desde` y deja la base al dia:
 * 1. Relee el listado completo del periodo y guarda/actualiza cada guia (asi
 *    una anulacion posterior cambia su sii_status).
 * 2. A las validas sin productos les trae el detalle, hasta `presupuestoMs`.
 *    Lo que no alcance queda pendiente y lo toma la proxima corrida.
 */
export async function sincronizarVentas({
  desde,
  origen,
  presupuestoMs = Infinity,
}: {
  desde: string;
  origen: SincronizacionVentas["origen"];
  presupuestoMs?: number;
}): Promise<ResumenSincronizacionVentas> {
  const supabase = getSupabaseServiceClient();
  const inicio = Date.now();
  const { data: registro } = await supabase
    .from("sincronizaciones_ventas")
    .insert({ origen, desde, estado: "en_curso" })
    .select("id")
    .single();

  try {
    const guias = await recorrerGuiasDesde(desde);
    for (const lote of dividirEnLotes(guias.map(filaGuia), 500)) {
      const { error } = await supabase.from("ventas_guias").upsert(lote, { onConflict: "dte_id" });
      if (error) throw new Error(`No se pudieron guardar las guías: ${error.message}`);
    }

    const pendientes = await traerTodasLasFilas((d, h) =>
      supabase
        .from("ventas_guias")
        .select("dte_id")
        .eq("lineas_cargadas", false)
        .eq("anulada", false)
        .gte("fecha", desde)
        .order("fecha", { ascending: false })
        .order("dte_id", { ascending: true })
        .range(d, h)
    );

    let detallesCargados = 0;
    for (const lote of dividirEnLotes(pendientes, DETALLES_EN_PARALELO)) {
      if (Date.now() - inicio > presupuestoMs) break;
      await Promise.all(lote.map((p) => cargarDetalle(p.dte_id)));
      detallesCargados += lote.length;
    }

    const resumen: ResumenSincronizacionVentas = {
      guiasListadas: guias.length,
      anuladas: guias.filter((g) => g.sii_status === "cancel").length,
      detallesCargados,
      detallesPendientes: pendientes.length - detallesCargados,
      segundos: Math.round((Date.now() - inicio) / 1000),
    };
    if (registro) {
      await supabase
        .from("sincronizaciones_ventas")
        .update({
          estado: resumen.detallesPendientes > 0 ? "parcial" : "ok",
          resumen,
          terminada_en: new Date().toISOString(),
        })
        .eq("id", registro.id);
    }
    return resumen;
  } catch (err) {
    if (registro) {
      await supabase
        .from("sincronizaciones_ventas")
        .update({
          estado: "error",
          error: err instanceof Error ? err.message : String(err),
          terminada_en: new Date().toISOString(),
        })
        .eq("id", registro.id);
    }
    throw err;
  }
}

/** La actualizacion diaria: los ultimos MESES_A_RELEER meses mas el mes en curso. */
export function sincronizarVentasDiaria(presupuestoMs: number) {
  return sincronizarVentas({ desde: inicioMesesAtras(MESES_A_RELEER), origen: "automatica", presupuestoMs });
}

/** Cuando terminó la ultima actualizacion de ventas que dejo datos (ok o parcial). */
export async function obtenerUltimaActualizacionVentas(): Promise<string | null> {
  const { data } = await getSupabaseServiceClient()
    .from("sincronizaciones_ventas")
    .select("terminada_en")
    .in("estado", ["ok", "parcial"])
    .order("terminada_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.terminada_en ?? null;
}
