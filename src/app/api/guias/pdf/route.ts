import { z } from "zod";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { obtenerUrlFirmadaPdf } from "@/lib/storage/guias-pdf";
import { construirNombreDescargaPdf } from "@/lib/historial/nombre-pdf";
import { obtenerUsuario } from "@/lib/auth/sesion";
import { recuperarPdfGuia } from "@/lib/storage/recuperar-pdf";

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

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Pagina simple en vez de texto plano: se abre en una pestana a la vista de quien opera. */
function aviso(mensaje: string, status: number): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF de la guía</title><style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222;background:#fff}@media(prefers-color-scheme:dark){body{color:#eee;background:#1a1a22}}</style></head><body><p>${escapar(mensaje)}</p><p>Puedes cerrar esta pestaña.</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

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

  // La corrida (dueña y empresa) y la guía dependen solo de los parámetros: se piden a la vez.
  const [{ data: corridaRow }, { data: guia }] = await Promise.all([
    supabase.from("corridas").select("usuario_id, empresa_id, archivo_original_nombre").eq("id", corrida).maybeSingle(),
    supabase
      .from("guias_generadas")
      .select("pdf_path, centro, categoria, dte_id_relbase")
      .eq("corrida_id", corrida)
      .eq("folio_relbase", folio)
      .eq("estado", "generada")
      .is("eliminado_en", null)
      // Primero una fila con PDF, si la hay.
      .order("pdf_path", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Un operador solo puede abrir los PDF de sus propias corridas, mas los de los traspasos de
  // costos (la pantalla de Traspaso, abierta a operadores, lista los anteriores de todos).
  // Va antes del 404 para no revelar a un tercero qué guías existen.
  const esTraspaso = corridaRow?.archivo_original_nombre?.startsWith("Traspaso de costos") ?? false;
  if (usuario.rol !== "admin" && !esTraspaso && (!corridaRow || corridaRow.usuario_id !== usuario.id)) {
    return new Response("No tienes acceso a esa guia.", { status: 403 });
  }

  if (!guia) return aviso("No se encontró esa guía.", 404);

  // Sin PDF guardado (Relbase aun no lo tenia al emitirla): se pide ahora.
  let pdfPath = guia.pdf_path;
  if (!pdfPath && guia.dte_id_relbase != null && corridaRow) {
    const { data: empresaCorrida } = await supabase
      .from("empresas")
      .select("codigo_interno")
      .eq("id", corridaRow.empresa_id)
      .maybeSingle();
    pdfPath = await recuperarPdfGuia({
      corridaId: corrida,
      folio,
      dteId: Number(guia.dte_id_relbase),
      empresaCodigo: empresaCorrida?.codigo_interno ?? "sin-empresa",
      categoria: guia.categoria,
      centro: guia.centro,
    });
  }
  if (!pdfPath) {
    return aviso(
      `Relbase todavía no entrega el PDF de la guía ${folio}. Intenta de nuevo en unos minutos o descárgalo desde Relbase.`,
      404
    );
  }

  let nombreDescarga: string | undefined;
  if (modo === "descargar") {
    const { data: empresa } = corridaRow
      ? await supabase.from("empresas").select("nombre").eq("id", corridaRow.empresa_id).maybeSingle()
      : { data: null };

    nombreDescarga = construirNombreDescargaPdf(empresa?.nombre, guia.centro, folio);
  }

  const firmada = await obtenerUrlFirmadaPdf(
    pdfPath,
    DURACION_FIRMA_SEGUNDOS,
    nombreDescarga
  );

  if (!firmada) {
    return aviso("No se pudo abrir el PDF. Intenta de nuevo.", 502);
  }

  // no-store: la URL firmada vence en minutos, y un redirect cacheado mandaria
  // al usuario a un enlace muerto.
  return new Response(null, {
    status: 307,
    headers: { Location: firmada, "Cache-Control": "no-store" },
  });
}
