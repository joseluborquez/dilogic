import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuario } from "@/lib/auth/sesion";
import {
  COOKIE_OAUTH,
  COOKIE_OAUTH_RUTA,
  RelbaseOAuthError,
  canjearCodigo,
  guardarConexion,
} from "@/lib/relbase/oauth";

function mismoTexto(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Paso 2 del OAuth con Relbase: Relbase vuelve aca con ?code&state. Se valida
 * el state contra la cookie (CSRF), se canjea el code y se guardan los tokens
 * cifrados en relbase_conexion.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") {
    return new Response("Sesion requerida.", { status: 401 });
  }
  if (usuario.rol !== "admin") {
    return new Response("Solo un administrador puede conectar Relbase.", { status: 403 });
  }

  const volver = (consulta: string) => {
    const respuesta = NextResponse.redirect(new URL(`/empresas?${consulta}`, request.url));
    // De un solo uso, salga bien o mal.
    respuesta.cookies.set(COOKIE_OAUTH, "", { path: COOKIE_OAUTH_RUTA, maxAge: 0 });
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    // Ej. access_denied si el admin cancela en Relbase.
    return volver(`relbase=error&motivo=${encodeURIComponent(params.get("error")!)}`);
  }

  let guardado: { state?: unknown; verifier?: unknown } = {};
  try {
    guardado = JSON.parse(request.cookies.get(COOKIE_OAUTH)?.value ?? "{}");
  } catch {
    // Cookie alterada: se trata como ausente.
  }
  const state = params.get("state");
  const code = params.get("code");
  if (
    typeof guardado.state !== "string" ||
    typeof guardado.verifier !== "string" ||
    !state ||
    !code ||
    !mismoTexto(state, guardado.state)
  ) {
    return volver("relbase=error&motivo=state");
  }

  try {
    const tokens = await canjearCodigo(code, guardado.verifier);
    await guardarConexion(tokens, usuario.id);
  } catch (err) {
    console.error(
      "OAuth Relbase: fallo el canje del code",
      err instanceof RelbaseOAuthError ? { status: err.status, body: err.body } : err
    );
    return volver("relbase=error&motivo=canje");
  }

  return volver("relbase=conectado");
}
