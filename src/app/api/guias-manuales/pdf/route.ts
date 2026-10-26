import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { obtenerUsuario } from "@/lib/auth/sesion";
import { obtenerPdfUrlDte } from "@/lib/relbase/client";

/**
 * PDF de una guia manual: no se guarda en Storage, se pide a Relbase al hacer
 * click y se redirige. Un operador solo abre las guias que emitio el mismo.
 */
const Parametros = z.object({ id: z.uuid() });

export async function GET(request: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") return new Response("Sesion requerida.", { status: 401 });

  const parseo = Parametros.safeParse({ id: new URL(request.url).searchParams.get("id") ?? undefined });
  if (!parseo.success) return new Response("Solicitud inválida.", { status: 400 });

  const { data: guia } = await getSupabaseServiceClient()
    .from("guias_manuales")
    .select("dte_id, usuario_id")
    .eq("id", parseo.data.id)
    .maybeSingle();
  if (!guia?.dte_id) return new Response("Esa guía no tiene PDF en Relbase.", { status: 404 });
  if (usuario.rol !== "admin" && guia.usuario_id !== usuario.id) return new Response("No tienes acceso a esa guía.", { status: 403 });

  const url = await obtenerPdfUrlDte(Number(guia.dte_id), { intentos: 2 }).catch(() => null);
  if (!url) return new Response("Relbase no entregó el PDF. Prueba de nuevo en un momento.", { status: 502 });
  return Response.redirect(url, 302);
}
