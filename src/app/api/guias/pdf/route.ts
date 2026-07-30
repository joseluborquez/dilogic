import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { obtenerUrlFirmadaPdf } from "@/lib/storage/guias-pdf";
import { construirNombreDescargaPdf } from "@/lib/historial/nombre-pdf";
import { obtenerUsuario } from "@/lib/auth/sesion";

/**
 * Firma la URL del PDF de una guia en el momento del click y redirige a ella.
 *
 * Antes el historial firmaba por adelantado las dos URLs (ver / descargar) de
 * cada guia en cada carga de pagina: ~2 llamadas a Storage por guia, ~500 por
 * carga con el historial lleno. Al firmar bajo demanda, renderizar el historial
 * no hace ninguna llamada a Storage y da lo mismo cuantas guias se muestren.
 *
 * La URL firmada dura poco a proposito: se usa de inmediato en el redirect y
 * no queda pegada en el HTML ni en el historial del navegador.
 */
const DURACION_FIRMA_SEGUNDOS = 300;

const Parametros = z.object({
  corrida: z.uuid(),
  folio: z.string().min(1),
  modo: z.enum(["ver", "descargar"]).default("ver"),
});

export async function GET(request: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") {
    return new Response("Sesion requerida.", { status: 401 });
  }

  const url = new URL(request.url);
  const parseo = Parametros.safeParse({
    corrida: url.searchParams.get("corrida") ?? undefined,
    folio: url.searchParams.get("folio") ?? undefined,
    modo: url.searchParams.get("modo") ?? undefined,
  });

  if (!parseo.success) {
    return new Response("Solicitud inválida.", { status: 400 });
  }
  const { corrida, folio, modo } = parseo.data;

  const supabase = getSupabaseServiceClient();

  // Un operador solo puede abrir los PDF de sus propias corridas.
  if (usuario.rol !== "admin") {
    const { data: duena } = await supabase
      .from("corridas")
      .select("usuario_id")
      .eq("id", corrida)
      .maybeSingle();
    if (!duena || duena.usuario_id !== usuario.id) {
      return new Response("No tienes acceso a esa guia.", { status: 403 });
    }
  }

  const { data: guia } = await supabase
    .from("guias_generadas")
    .select("pdf_path, centro, corrida_id")
    .eq("corrida_id", corrida)
    .eq("folio_relbase", folio)
    .is("eliminado_en", null)
    .not("pdf_path", "is", null)
    .limit(1)
    .maybeSingle();

  if (!guia?.pdf_path) {
    return new Response("Esa guía no tiene PDF guardado.", { status: 404 });
  }

  let nombreDescarga: string | undefined;
  if (modo === "descargar") {
    const { data: corridaRow } = await supabase
      .from("corridas")
      .select("empresa_id")
      .eq("id", guia.corrida_id)
      .maybeSingle();
    const { data: empresa } = corridaRow
      ? await supabase.from("empresas").select("nombre").eq("id", corridaRow.empresa_id).maybeSingle()
      : { data: null };

    nombreDescarga = construirNombreDescargaPdf(empresa?.nombre, guia.centro, folio);
  }

  const firmada = await obtenerUrlFirmadaPdf(
    guia.pdf_path,
    DURACION_FIRMA_SEGUNDOS,
    nombreDescarga
  );

  if (!firmada) {
    return new Response("No se pudo abrir el PDF.", { status: 502 });
  }

  // no-store: la URL firmada vence en minutos, y un redirect cacheado mandaria
  // al usuario a un enlace muerto.
  return new Response(null, {
    status: 307,
    headers: { Location: firmada, "Cache-Control": "no-store" },
  });
}
