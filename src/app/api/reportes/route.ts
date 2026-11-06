import { obtenerUsuario } from "@/lib/auth/sesion";
import { EMPRESAS_REPORTE, guiasDeEmpresa, lineasDeGuias, rango, type EmpresaReporte } from "@/lib/reportes/datos";
import { armarReporte } from "@/lib/reportes/excel";

/**
 * Descarga el Excel del reporte de una empresa para el periodo elegido.
 * Un solo periodo (desde/hasta) para todas, Cermaq incluida. Los datos se leen solo al descargar y solo del periodo.
 * Si el periodo llega a hoy, incluye lo emitido hoy (leido de Relbase).
 */
export async function GET(request: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") return new Response("Sesion requerida.", { status: 401 });

  const q = new URL(request.url).searchParams;
  const empresa = q.get("empresa") as EmpresaReporte;
  if (!EMPRESAS_REPORTE.includes(empresa)) return new Response("Empresa inválida.", { status: 400 });

  const periodo = rango(q.get("desde") ?? "", q.get("hasta") ?? "");
  if (!periodo) return new Response("Elige el período.", { status: 400 });
  const { guias, sinHoy } = await guiasDeEmpresa(empresa, periodo.desde, periodo.hasta);
  // Un reporte al que le faltan las guias de hoy se veria completo: mejor no entregarlo.
  if (sinHoy) {
    return new Response("Relbase no respondió y faltarían las guías emitidas hoy. Intenta de nuevo en unos minutos.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const lineas = empresa === "MTX" ? await lineasDeGuias(guias.map((g) => g.dteId)) : [];
  const reporte = armarReporte(empresa, periodo, guias, lineas);

  return new Response(Buffer.from(reporte.contenido), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(reporte.nombreArchivo)}`,
      "Cache-Control": "no-store",
    },
  });
}
