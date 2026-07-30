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
 * Perfiles con lo que ha generado cada uno. Es la vista que pidio el
 * administrador: quien esta emitiendo guias y cuantas.
 */
export async function obtenerResumenUsuarios(): Promise<ResumenUsuario[]> {
  const supabase = getSupabaseServiceClient();

  const { data: perfiles } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, estado, created_at")
    .order("created_at", { ascending: true });

  const { data: corridas } = await supabase
    .from("corridas")
    .select("id, usuario_id, fecha_ejecucion");

  const corridasPorUsuario = new Map<string, { ids: string[]; ultima: string | null }>();
  for (const corrida of corridas ?? []) {
    if (!corrida.usuario_id) continue; // corridas anteriores a la autenticacion
    const actual = corridasPorUsuario.get(corrida.usuario_id) ?? { ids: [], ultima: null };
    actual.ids.push(corrida.id);
    if (!actual.ultima || (corrida.fecha_ejecucion ?? "") > actual.ultima) {
      actual.ultima = corrida.fecha_ejecucion;
    }
    corridasPorUsuario.set(corrida.usuario_id, actual);
  }

  // Una guia son muchas filas (una por SKU): se cuentan documentos distintos
  // por corrida + folio, igual que en el historial.
  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("guias_generadas")
      .select("corrida_id, folio_relbase, estado")
      .is("eliminado_en", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const guiasPorCorrida = new Map<string, { emitidas: Set<string>; errores: Set<string> }>();
  for (const fila of filas) {
    const actual = guiasPorCorrida.get(fila.corrida_id) ?? {
      emitidas: new Set<string>(),
      errores: new Set<string>(),
    };
    if (fila.estado === "generada" && fila.folio_relbase) {
      actual.emitidas.add(fila.folio_relbase);
    } else if (fila.estado === "error") {
      actual.errores.add(`${fila.corrida_id}`);
    }
    guiasPorCorrida.set(fila.corrida_id, actual);
  }

  return (perfiles ?? []).map((p) => {
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
}

/** Guias emitidas antes de que existiera la autenticacion, sin dueño. */
export async function contarGuiasSinUsuario(): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data: corridas } = await supabase
    .from("corridas")
    .select("id")
    .is("usuario_id", null);
  if (!corridas || corridas.length === 0) return 0;

  const ids = new Set(corridas.map((c) => c.id));
  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("guias_generadas")
      .select("corrida_id, folio_relbase, estado")
      .eq("estado", "generada")
      .is("eliminado_en", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const folios = new Set(
    filas.filter((f) => ids.has(f.corrida_id) && f.folio_relbase).map((f) => f.folio_relbase)
  );
  return folios.size;
}
