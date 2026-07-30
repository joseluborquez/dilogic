"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { requerirAdmin } from "@/lib/auth/sesion";

export interface ResultadoUsuario {
  ok: boolean;
  mensaje?: string;
}

/**
 * Aprobar, bloquear o cambiar el rol de una cuenta. Cada accion revalida que
 * quien la ejecuta sea administrador: una server action es un endpoint
 * publico, no basta con que el boton solo se vea en la vista de admin.
 */
export async function cambiarEstadoUsuarioAction(
  id: string,
  estado: "activo" | "pendiente" | "bloqueado"
): Promise<ResultadoUsuario> {
  const admin = await requerirAdmin();
  if (id === admin.id && estado !== "activo") {
    return { ok: false, mensaje: "No puedes desactivar tu propia cuenta." };
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("perfiles")
    .update({
      estado,
      activado_en: estado === "activo" ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) return { ok: false, mensaje: "No se pudo cambiar el estado." };

  revalidatePath("/usuarios");
  return { ok: true };
}

export async function cambiarRolUsuarioAction(
  id: string,
  rol: "admin" | "operador"
): Promise<ResultadoUsuario> {
  const admin = await requerirAdmin();
  if (id === admin.id && rol !== "admin") {
    return {
      ok: false,
      mensaje: "No puedes quitarte el rol de administrador a ti mismo.",
    };
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("perfiles").update({ rol }).eq("id", id);
  if (error) return { ok: false, mensaje: "No se pudo cambiar el rol." };

  revalidatePath("/usuarios");
  return { ok: true };
}
