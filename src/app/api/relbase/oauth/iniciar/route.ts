import { NextResponse } from "next/server";
import { obtenerUsuario } from "@/lib/auth/sesion";
import {
  COOKIE_OAUTH,
  COOKIE_OAUTH_DURACION_SEGUNDOS,
  COOKIE_OAUTH_RUTA,
  obtenerConfigOAuth,
  prepararAutorizacion,
} from "@/lib/relbase/oauth";

/**
 * Paso 1 del OAuth con Relbase: guarda state + code_verifier en una cookie
 * httpOnly y manda al admin a autorizar en Relbase.
 */
export async function GET(request: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") {
    return new Response("Sesion requerida.", { status: 401 });
  }
  if (usuario.rol !== "admin") {
    return new Response("Solo un administrador puede conectar Relbase.", { status: 403 });
  }

  const volver = (motivo: string) =>
    NextResponse.redirect(new URL(`/empresas?relbase=error&motivo=${motivo}`, request.url));

  let redirectUri: string;
  try {
    redirectUri = obtenerConfigOAuth().redirectUri;
  } catch {
    return volver("configuracion");
  }

  // Relbase devuelve siempre a la redirect_uri registrada (solo https, ver
  // .env.local.example). Si se inicia desde otro origen (ej. localhost), la
  // cookie quedaria en ese origen y el callback la perderia.
  if (new URL(redirectUri).origin !== new URL(request.url).origin) {
    return volver("origen");
  }

  const { url, state, verifier } = prepararAutorizacion();
  const respuesta = NextResponse.redirect(url);
  respuesta.cookies.set(COOKIE_OAUTH, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    // lax (no strict): la vuelta desde api.relbase.cl es una navegacion de
    // otro sitio y con strict el navegador no mandaria la cookie.
    sameSite: "lax",
    path: COOKIE_OAUTH_RUTA,
    maxAge: COOKIE_OAUTH_DURACION_SEGUNDOS,
  });
  respuesta.headers.set("Cache-Control", "no-store");
  return respuesta;
}
