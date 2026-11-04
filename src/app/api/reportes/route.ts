import { obtenerUsuario } from "@/lib/auth/sesion";
import { EMPRESAS_REPORTE, guiasDeEmpresa, lineasDeGuias, rango, type EmpresaReporte } from "@/lib/reportes/datos";
import { armarReporte } from "@/lib/reportes/excel";

/**
 * Descarga el Excel del reporte de una empresa para el periodo elegido.
 * Un solo periodo (desde/hasta) para todas, Cermaq incluida. Los datos se leen solo al descargar y solo del periodo.
 */
export async function GET(request: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario || usuario.estado !== "activo") return new Response("Sesion requerida.", { status: 401 });

  const q = new URL(request.url).searchParams;
  const empresa = q.get("empresa") as EmpresaReporte;
  if (!EMPRESAS_REPORTE.includes(empresa)) return new Response("Empresa inválida.", { status: 400 });

  const periodo = rango(q.get("desde") ?? "", q.get("hasta") ?? "");
  if (!periodo) return new Response("Elige el período.", { status: 400 });
  const guias = await guiasDeEmpresa(empresa, periodo.desde, periodo.hasta);
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
