import "server-only";

import { obtenerDte } from "@/lib/relbase/client";
import type { RelbaseDteResumen } from "@/lib/relbase/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { enLotes } from "@/lib/util/lotes";
import { clasificarCodigo } from "./clasificar";
import {
  agregar,
  empresasPorCliente,
  esBins,
  hoyChile,
  type AgregadoPeriodo,
  type LineaParaAgregar,
} from "./indicadores";
import { recorrerGuiasDesde } from "./recorrer";

/**
 * Ventas de hoy leidas directo de Relbase: la sincronizacion diaria trae el dia
 * recien a la manana siguiente. Se calculan con las mismas reglas que lo
 * sincronizado (agregar) y la pagina de inicio las junta con el mes.
 * Ademas de las reglas de siempre (sin anuladas ni bins), aqui no cuentan las
 * guias con todos sus productos a $1.
 */

/** Cada cuanto se vuelve a preguntar a Relbase. */
const VIGENCIA_MS = 5 * 60 * 1000;

/** El contenido de una guia emitida no cambia: sus productos se piden una sola vez. */
const lineasPorGuia = new Map<number, LineaParaAgregar[]>();
let ultimo: { guias: RelbaseDteResumen[]; fecha: string; en: number } | null = null;
let enCurso: Promise<{ guias: RelbaseDteResumen[]; fecha: string }> | null = null;

async function leer(): Promise<{ guias: RelbaseDteResumen[]; fecha: string }> {
  const fecha = hoyChile();
  const guias = (await recorrerGuiasDesde(fecha)).filter((g) => g.start_date === fecha);
  // Productos solo de las guias nuevas, de a 5 a la vez (el cliente igual respeta el limite de Relbase).
  const sinDetalle = guias.filter((g) => g.sii_status !== "cancel" && !esBins(g.contact) && !lineasPorGuia.has(g.id));
  await enLotes(sinDetalle, 5, async (g) => {
    const productos = (await obtenerDte(g.id)).products ?? [];
    lineasPorGuia.set(
      g.id,
      productos.map((p) => {
        const cantidad = Number(p.quantity) || 0;
        const precio = Number(p.price) || 0;
        const descuento = p.discount == null ? 0 : Number(p.discount);
        return {
          dte_id: g.id,
          codigo: p.code,
          nombre: p.name,
          ...clasificarCodigo(p.code, p.product_id),
          cantidad,
          precio,
          // Igual que la sincronizacion (lib/ventas/sincronizar.ts).
          monto_neto: Math.round(cantidad * precio * (1 - descuento / 100)),
        };
      })
    );
  });
  return { guias, fecha };
}

async function guiasDeHoy() {
  if (ultimo && Date.now() - ultimo.en < VIGENCIA_MS && ultimo.fecha === hoyChile()) return ultimo;
  // Si dos consultas llegan juntas, comparten la misma lectura.
  enCurso ??= leer()
    .then((r) => {
      ultimo = { ...r, en: Date.now() };
      return r;
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

const todasAUnPeso = (lineas: LineaParaAgregar[]) => lineas.length > 0 && lineas.every((l) => Math.round(l.precio) <= 1);

/**
 * Guias de hoy que la sincronizacion todavia no trajo, tal como las lista
 * Relbase (anuladas incluidas). Si alguien sincroniza a mitad del dia, esas
 * guias ya estan en Supabase: se descartan consultando solo los dte_id de hoy
 * (unas pocas filas). Tambien la usan los reportes (lib/reportes/datos).
 */
export async function guiasNuevasDeHoy(): Promise<{ fecha: string; guias: RelbaseDteResumen[] }> {
  const { guias, fecha } = await guiasDeHoy();
  if (guias.length === 0) return { fecha, guias };
  const { data, error } = await getSupabaseServiceClient().from("ventas_guias").select("dte_id").eq("fecha", fecha);
  if (error) throw error;
  const ya = new Set((data ?? []).map((g) => Number(g.dte_id)));
  return { fecha, guias: guias.filter((g) => !ya.has(g.id)) };
}

/** Productos de una guia de guiasNuevasDeHoy (vacio en anuladas y bins por contacto: no se piden). */
export const lineasDeHoy = (dteId: number): LineaParaAgregar[] => lineasPorGuia.get(dteId) ?? [];

/** Lo de hoy que la sincronizacion todavia no trajo, listo para juntar con el mes. */
export async function agregadoDeHoy(): Promise<AgregadoPeriodo | null> {
  const [{ guias, fecha }, empresaDeCliente] = await Promise.all([guiasNuevasDeHoy(), empresasPorCliente()]);
  const nuevas = guias.filter((g) => !todasAUnPeso(lineasDeHoy(g.id)));
  if (nuevas.length === 0) return null;
  return agregar(
    fecha,
    fecha,
    nuevas.map((g) => ({
      dte_id: g.id,
      fecha: g.start_date,
      anulada: g.sii_status === "cancel",
      contacto: g.contact,
      customer_id: g.customer_id,
    })),
    nuevas.flatMap((g) => lineasDeHoy(g.id)),
    empresaDeCliente
  );
}
