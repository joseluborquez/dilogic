import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import type { EstadoUsuario, RolUsuario } from "./sesion";

export interface ResumenUsuario {
  id: string;
  email: string;
  nombre: string | null;
  rol: RolUsuario;
  estado: EstadoUsuario;
  creadoEn: string;
  /** Corridas (archivos de pedido) que ha procesado. */
  solicitudes: number;
  /** Guias emitidas: documentos distintos, no filas. */
  guias: number;
  guiasConError: number;
  ultimaActividad: string | null;
}

/**
 * Perfiles con lo que ha generado cada uno, y las guias sin dueño. Es la vista
 * que pidio el administrador: quien esta emitiendo guias y cuantas.
 *
 * Las tres lecturas salen juntas y las filas de guias se leen una sola vez:
 * antes el conteo "sin usuario" volvia a bajar la tabla entera (31 mil filas,
 * ~3,5 s la pagina, 28-oct-2026).
 */
export async function obtenerResumenUsuarios(): Promise<{ usuarios: ResumenUsuario[]; guiasSinUsuario: number }> {
  const supabase = getSupabaseServiceClient();

  const [{ data: perfiles }, { data: corridas }, filas] = await Promise.all([
    supabase
      .from("perfiles")
      .select("id, email, nombre, rol, estado, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("corridas").select("id, usuario_id, fecha_ejecucion"),
    // Una guia son muchas filas (una por SKU): se cuentan documentos distintos
    // por corrida + folio, igual que en el historial.
    traerTodasLasFilas((desde, hasta) =>
      supabase
        .from("guias_generadas")
        .select("corrida_id, folio_relbase, estado")
        .is("eliminado_en", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta)
    ),
  ]);

  const corridasPorUsuario = new Map<string, { ids: string[]; ultima: string | null }>();
  // Corridas anteriores a la autenticacion: no tienen usuario.
  const corridasSinUsuario = new Set<string>();
  for (const corrida of corridas ?? []) {
    if (!corrida.usuario_id) {
      corridasSinUsuario.add(corrida.id);
      continue;
    }
    const actual = corridasPorUsuario.get(corrida.usuario_id) ?? { ids: [], ultima: null };
    actual.ids.push(corrida.id);
    if (!actual.ultima || (corrida.fecha_ejecucion ?? "") > actual.ultima) {
      actual.ultima = corrida.fecha_ejecucion;
    }
    corridasPorUsuario.set(corrida.usuario_id, actual);
  }

  const guiasPorCorrida = new Map<string, { emitidas: Set<string>; errores: Set<string> }>();
  const foliosSinUsuario = new Set<string>();
  for (const fila of filas) {
    const actual = guiasPorCorrida.get(fila.corrida_id) ?? {
      emitidas: new Set<string>(),
      errores: new Set<string>(),
    };
    if (fila.estado === "generada" && fila.folio_relbase) {
      actual.emitidas.add(fila.folio_relbase);
      if (corridasSinUsuario.has(fila.corrida_id)) foliosSinUsuario.add(fila.folio_relbase);
    } else if (fila.estado === "error") {
      actual.errores.add(`${fila.corrida_id}`);
    }
    guiasPorCorrida.set(fila.corrida_id, actual);
  }

  const usuarios = (perfiles ?? []).map((p) => {
    const suyas = corridasPorUsuario.get(p.id) ?? { ids: [], ultima: null };
    let guias = 0;
    let guiasConError = 0;
    for (const corridaId of suyas.ids) {
      const conteo = guiasPorCorrida.get(corridaId);
      guias += conteo?.emitidas.size ?? 0;
      guiasConError += conteo?.errores.size ?? 0;
    }

    return {
      id: p.id,
      email: p.email,
      nombre: p.nombre,
      rol: p.rol as RolUsuario,
      estado: p.estado as EstadoUsuario,
      creadoEn: p.created_at,
      solicitudes: suyas.ids.length,
      guias,
      guiasConError,
      ultimaActividad: suyas.ultima,
    };
  });

  return { usuarios, guiasSinUsuario: foliosSinUsuario.size };
}
