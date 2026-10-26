import { revalidateTag } from "next/cache";
import { sincronizarVentasDiaria } from "@/lib/ventas/sincronizar";
import { TAG_VENTAS } from "@/lib/ventas/indicadores";
import { cronAutorizado } from "@/lib/cron/autorizar";

/**
 * Actualizacion diaria de ventas (vercel.json > crons): relee las guias de los
 * ultimos 3 meses (anulaciones tardias) y trae el detalle de las nuevas. Va
 * 15 min despues de la del catalogo para no compartir el limite de Relbase.
 */
export const maxDuration = 300;

/** Se deja margen bajo maxDuration para cerrar el registro aunque falten detalles. */
const PRESUPUESTO_MS = 240_000;

export async function GET(request: Request) {
  if (!cronAutorizado(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const resumen = await sincronizarVentasDiaria(PRESUPUESTO_MS);
    // La pagina de inicio muestra lo cacheado hasta que se pide de nuevo.
    revalidateTag(TAG_VENTAS, "max");
    return Response.json({ ok: true, ...resumen });
  } catch (err) {
    // Queda registrado en sincronizaciones_ventas.
    console.error("Sincronizacion automatica de ventas fallo", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
