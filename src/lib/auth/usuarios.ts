import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
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
 * El conteo lo hace la base (conteo_guias_por_corrida, migracion 0019): antes
 * se bajaban todas las filas de guias, una por SKU (31 mil, ~3,4 s la pagina,
 * 28-oct-2026), solo para contar folios distintos.
 */
export async function obtenerResumenUsuarios(): Promise<{ usuarios: ResumenUsuario[]; guiasSinUsuario: number }> {
  const supabase = getSupabaseServiceClient();

  const [{ data: perfiles }, { data: conteos, error }] = await Promise.all([
    supabase
      .from("perfiles")
      .select("id, email, nombre, rol, estado, created_at")
      .order("created_at", { ascending: true }),
    supabase.rpc("conteo_guias_por_corrida"),
  ]);
  if (error) throw new Error(`No se pudo contar las guías por usuario: ${error.message}`);

  const porUsuario = new Map<string, { solicitudes: number; guias: number; guiasConError: number; ultima: string | null }>();
  let guiasSinUsuario = 0;
  for (const c of conteos ?? []) {
    // Corridas anteriores a la autenticacion: no tienen usuario.
    if (!c.usuario_id) {
      guiasSinUsuario += c.guias;
      continue;
    }
    const actual = porUsuario.get(c.usuario_id) ?? { solicitudes: 0, guias: 0, guiasConError: 0, ultima: null };
    actual.solicitudes += 1;
    actual.guias += c.guias;
    if (c.con_error) actual.guiasConError += 1;
    if (!actual.ultima || (c.fecha_ejecucion ?? "") > actual.ultima) actual.ultima = c.fecha_ejecucion;
    porUsuario.set(c.usuario_id, actual);
  }

  const usuarios = (perfiles ?? []).map((p) => {
    const suyas = porUsuario.get(p.id);
    return {
      id: p.id,
      email: p.email,
      nombre: p.nombre,
      rol: p.rol as RolUsuario,
      estado: p.estado as EstadoUsuario,
      creadoEn: p.created_at,
      solicitudes: suyas?.solicitudes ?? 0,
      guias: suyas?.guias ?? 0,
      guiasConError: suyas?.guiasConError ?? 0,
      ultimaActividad: suyas?.ultima ?? null,
    };
  });

  return { usuarios, guiasSinUsuario };
}
