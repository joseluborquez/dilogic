import { NextResponse } from "next/server";
import { leerPase } from "@/lib/auth/pase";
import { getSupabaseAuthClient } from "@/lib/auth/supabase-sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Entrada con pase desde el buscador de productos: si el pase es válido y hay un perfil activo con ese correo, abre la
 * sesión de Supabase (enlace mágico generado y verificado aquí mismo, sin enviar correo) y lleva al destino. Si no, al
 * ingreso normal.
 */
export async function GET(req: Request) {
  const login = new URL("/login", req.url);
  const pase = await leerPase(new URL(req.url).searchParams.get("t"));
  if (!pase) return NextResponse.redirect(login);

  const servicio = getSupabaseServiceClient();
  const { data: perfil } = await servicio.from("perfiles").select("email, estado").ilike("email", pase.correo).maybeSingle();
  if (!perfil || perfil.estado !== "activo") return NextResponse.redirect(login);

  const { data: enlace, error } = await servicio.auth.admin.generateLink({ type: "magiclink", email: perfil.email });
  const tokenHash = enlace?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.redirect(login);
  const auth = await getSupabaseAuthClient();
  const { error: errorSesion } = await auth.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (errorSesion) return NextResponse.redirect(login);
  return NextResponse.redirect(new URL(pase.destino, req.url));
}
