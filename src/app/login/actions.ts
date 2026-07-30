"use server";

import { redirect } from "next/navigation";
import { getSupabaseAuthClient } from "@/lib/auth/supabase-sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DOMINIO_PERMITIDO,
  EMAIL_ADMIN_INICIAL,
  esCorreoPermitido,
} from "@/lib/auth/sesion";

export type EstadoLogin =
  | { status: "inicial" }
  | { status: "error"; mensaje: string }
  | { status: "registrado"; mensaje: string };

function rutaSegura(volver: string): string {
  // Solo rutas internas: un "volver" con URL absoluta permitiria mandar al
  // usuario a otro sitio despues de autenticarse.
  return volver.startsWith("/") && !volver.startsWith("//") ? volver : "/nueva-corrida";
}

export async function ingresarAction(
  _prevState: EstadoLogin,
  formData: FormData
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const volver = rutaSegura(String(formData.get("volver") ?? ""));

  if (!email || !password) {
    return { status: "error", mensaje: "Escribe tu correo y tu contraseña." };
  }

  const auth = await getSupabaseAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { status: "error", mensaje: "Correo o contraseña incorrectos." };
  }

  const supabase = getSupabaseServiceClient();
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("estado")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!perfil || perfil.estado !== "activo") {
    // Se cierra la sesion recien abierta: la cuenta existe pero todavia no
    // esta habilitada para operar.
    await auth.auth.signOut();
    return {
      status: "error",
      mensaje:
        perfil?.estado === "bloqueado"
          ? "Tu cuenta está bloqueada. Habla con el administrador."
          : "Tu cuenta todavía no está aprobada por el administrador.",
    };
  }

  redirect(volver);
}

export async function registrarAction(
  _prevState: EstadoLogin,
  formData: FormData
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();

  if (!esCorreoPermitido(email)) {
    return {
      status: "error",
      mensaje: `Solo se pueden registrar correos @${DOMINIO_PERMITIDO}.`,
    };
  }
  if (password.length < 8) {
    return { status: "error", mensaje: "La contraseña debe tener al menos 8 caracteres." };
  }
  if (!nombre) {
    return { status: "error", mensaje: "Escribe tu nombre." };
  }

  const supabase = getSupabaseServiceClient();

  // La cuenta se crea con la clave de servicio y `email_confirm: true`: asi no
  // depende de que llegue un correo de confirmacion (el servicio por defecto
  // de Supabase tiene un limite bajo de envios). La barrera no es el correo,
  // es la aprobacion del administrador.
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    const yaExiste = error?.message?.toLowerCase().includes("already");
    return {
      status: "error",
      mensaje: yaExiste
        ? "Ya existe una cuenta con ese correo."
        : "No se pudo crear la cuenta. Intenta de nuevo.",
    };
  }

  // El primer administrador queda activo de entrada: sin el no habria quien
  // aprobara a nadie.
  const esAdminInicial = email === EMAIL_ADMIN_INICIAL;

  const { error: errPerfil } = await supabase.from("perfiles").insert({
    id: data.user.id,
    email,
    nombre,
    rol: esAdminInicial ? "admin" : "operador",
    estado: esAdminInicial ? "activo" : "pendiente",
    activado_en: esAdminInicial ? new Date().toISOString() : null,
  });

  if (errPerfil) {
    // Sin perfil la cuenta no sirve para nada y quedaria huerfana en auth.
    await supabase.auth.admin.deleteUser(data.user.id);
    return { status: "error", mensaje: "No se pudo crear el perfil. Intenta de nuevo." };
  }

  return {
    status: "registrado",
    mensaje: esAdminInicial
      ? "Cuenta de administrador creada. Ya puedes entrar."
      : "Cuenta creada. Un administrador debe aprobarla antes de que puedas entrar.",
  };
}

export async function cerrarSesionAction(): Promise<void> {
  const auth = await getSupabaseAuthClient();
  await auth.auth.signOut();
  redirect("/login");
}
