import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getSupabaseAuthClient } from "./supabase-sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type RolUsuario = "admin" | "operador";
export type EstadoUsuario = "pendiente" | "activo" | "bloqueado";

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string | null;
  rol: RolUsuario;
  estado: EstadoUsuario;
}

export { DOMINIO_PERMITIDO, EMAIL_ADMIN_INICIAL, esCorreoPermitido } from "./constantes";

/**
 * Usuario de la sesion actual, o null si no hay o no tiene perfil. Con `cache`
 * el layout y la pagina de un mismo request consultan Supabase una sola vez.
 */
export const obtenerUsuario = cache(async (): Promise<UsuarioSesion | null> => {
  const auth = await getSupabaseAuthClient();
  // getClaims (y no getSession) porque verifica la firma del token, que el
  // navegador no puede fabricar; lo hace localmente con las llaves publicas
  // de Supabase, sin el viaje de red de getUser. Bloqueos y bajas igual se
  // respetan: el estado sale de "perfiles" abajo.
  const { data } = await auth.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const supabase = getSupabaseServiceClient();
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, estado")
    .eq("id", userId)
    .maybeSingle();

  if (!perfil) return null;

  return {
    id: perfil.id,
    email: perfil.email,
    nombre: perfil.nombre,
    rol: perfil.rol as RolUsuario,
    estado: perfil.estado as EstadoUsuario,
  };
});

/**
 * Exige sesion activa. El proxy ya redirige a quien no tiene cookie, pero eso
 * es solo una comprobacion optimista: la verdadera va aca, en el servidor,
 * porque una cookie se puede fabricar y el proxy no consulta la base.
 */
export async function requerirUsuario(): Promise<UsuarioSesion> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");
  if (usuario.estado !== "activo") redirect("/login?estado=pendiente");
  return usuario;
}

/** Exige ademas rol de administrador. */
export async function requerirAdmin(): Promise<UsuarioSesion> {
  const usuario = await requerirUsuario();
  if (usuario.rol !== "admin") redirect("/");
  return usuario;
}
