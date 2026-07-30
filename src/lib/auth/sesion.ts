import "server-only";

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

/** Usuario de la sesion actual, o null si no hay o no tiene perfil. */
export async function obtenerUsuario(): Promise<UsuarioSesion | null> {
  const auth = await getSupabaseAuthClient();
  // getUser (y no getSession) porque valida el token contra Supabase en vez de
  // confiar en la cookie, que el navegador puede alterar.
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return null;

  const supabase = getSupabaseServiceClient();
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, estado")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) return null;

  return {
    id: perfil.id,
    email: perfil.email,
    nombre: perfil.nombre,
    rol: perfil.rol as RolUsuario,
    estado: perfil.estado as EstadoUsuario,
  };
}

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
  if (usuario.rol !== "admin") redirect("/nueva-corrida?sinPermiso=1");
  return usuario;
}
