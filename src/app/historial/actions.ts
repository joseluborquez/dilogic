"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { claveGuia, corridasDeClaves, type FilaConClave } from "@/lib/historial/claves";

export interface ResultadoEliminacion {
  ok: boolean;
  eliminadas: number;
  mensaje?: string;
}

type FilaAEliminar = FilaConClave & { id: string };

const USUARIO = "Hugo Venegas";

/**
 * Eliminacion logica: saca las guias del historial de la app sin borrar las
 * filas. Una guia de despacho es un DTE ya emitido ante el SII — esta accion
 * NO la anula en Relbase, solo deja de mostrarla aqui. La fila queda marcada
 * con eliminado_en/eliminado_por, asi que se puede revertir desde la base y el
 * PDF sigue guardado en el bucket.
 *
 * Es idempotente: reeliminar algo ya eliminado no hace nada (filtra por
 * eliminado_en null), asi que un doble click no rompe nada.
 */
export async function eliminarGuiasAction(claves: string[]): Promise<ResultadoEliminacion> {
  if (!Array.isArray(claves) || claves.length === 0) {
    return { ok: false, eliminadas: 0, mensaje: "No hay guías seleccionadas." };
  }

  const corridas = corridasDeClaves(claves);
  if (corridas.length === 0) {
    return { ok: false, eliminadas: 0, mensaje: "La selección no es válida." };
  }

  const supabase = getSupabaseServiceClient();

  // Se recalculan las claves desde las filas reales en vez de confiar en lo
  // que manda el cliente (mismo criterio que la descarga masiva). Paginado:
  // una guia son muchas filas (una por SKU) y dejar filas fuera haria que la
  // guia reapareciera a medias en el historial.
  let filas: FilaAEliminar[];
  try {
    filas = await traerTodasLasFilas<FilaAEliminar>((desde, hasta) =>
      supabase
        .from("guias_generadas")
        .select("id, corrida_id, folio_relbase, estado, categoria, centro, mensaje_error")
        .in("corrida_id", corridas)
        .is("eliminado_en", null)
        .order("created_at", { ascending: true })
        .range(desde, hasta)
    );
  } catch {
    return { ok: false, eliminadas: 0, mensaje: "No se pudieron leer las guías a eliminar." };
  }

  const pedidas = new Set(claves);
  const seleccionadas = filas.filter((f) => pedidas.has(claveGuia(f)));
  const ids = seleccionadas.map((f) => f.id);

  if (ids.length === 0) {
    return { ok: true, eliminadas: 0, mensaje: "Esas guías ya no estaban en el historial." };
  }

  const eliminadoEn = new Date().toISOString();
  // Por tandas: `in` con listas muy largas puede pasarse del limite de URL.
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("guias_generadas")
      .update({ eliminado_en: eliminadoEn, eliminado_por: USUARIO })
      .in("id", ids.slice(i, i + 200));

    if (error) {
      revalidatePath("/historial");
      return {
        ok: false,
        eliminadas: i,
        mensaje: "Se eliminaron algunas guías, pero la operación falló a mitad de camino.",
      };
    }
  }

  revalidatePath("/historial");

  // Nota: los totales de `corridas` no se tocan a proposito — registran lo que
  // ocurrio en la generacion (cuantas guias se emitieron realmente), no lo que
  // queda visible en el historial.

  // Se informa en guias (documentos), no en filas: una guia son varias filas.
  const documentos = new Set(seleccionadas.map(claveGuia)).size;

  return { ok: true, eliminadas: documentos };
}
