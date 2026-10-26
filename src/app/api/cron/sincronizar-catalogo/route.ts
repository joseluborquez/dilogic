import { sincronizarCatalogoCompleto } from "@/lib/catalogo/sincronizar";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { cronAutorizado } from "@/lib/cron/autorizar";

/**
 * Sincronizacion automatica diaria del catalogo con Relbase (vercel.json >
 * crons). Hoy tarda ~2 min; 300 s es el maximo de una funcion en el plan
 * gratuito de Vercel.
 */
export const maxDuration = 300;

/** Una sincronizacion "en curso" mas vieja que esto se considera muerta. */
const EN_CURSO_VIGENTE_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  if (!cronAutorizado(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Si alguien esta sincronizando a mano en este momento, no se pisa.
  const { data: enCurso } = await getSupabaseServiceClient()
    .from("sincronizaciones_catalogo")
    .select("id")
    .eq("estado", "en_curso")
    .gte("iniciada_en", new Date(Date.now() - EN_CURSO_VIGENTE_MS).toISOString())
    .limit(1)
    .maybeSingle();
  if (enCurso) {
    return Response.json({ ok: false, motivo: "Ya hay una sincronizacion en curso." });
  }

  try {
    const resumen = await sincronizarCatalogoCompleto("automatica");
    return Response.json({
      ok: true,
      actualizados: resumen.actualizados,
      insertados: resumen.insertados,
      bloqueados: resumen.bloqueados.map((b) => b.sku),
      reactivados: resumen.reactivados.map((r) => r.sku),
    });
  } catch (err) {
    // Queda registrado en sincronizaciones_catalogo y se ve en Catalogo.
    console.error("Sincronizacion automatica del catalogo fallo", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
