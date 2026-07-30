import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { obtenerUrlFirmadaPdf } from "@/lib/storage/guias-pdf";
import { construirNombreDescargaPdf } from "./nombre-pdf";
import { claveGuia } from "./claves";

export interface GuiaAgrupada {
  /** Identifica el documento (corrida + folio). Ver lib/historial/claves.ts. */
  clave: string;
  folio: string | null;
  centro: string | null;
  categoria: string | null;
  estado: "generada" | "error";
  cantidadProductos: number;
  cantidadTotal: number;
  fecha: string | null;
  mensajeError: string | null;
  pdfUrl: string | null; // para ver inline en el navegador
  pdfUrlDescarga: string | null; // fuerza descarga con nombre empresa-contacto-folio
}

/**
 * Una solicitud = una corrida = un archivo de pedido subido. Es la unidad con
 * la que razona el operador ("el pedido de Cermaq del martes") y sobre la que
 * se descarga o elimina en bloque.
 */
export interface SolicitudAgrupada {
  corridaId: string;
  empresaCodigo: string;
  empresaNombre: string;
  archivo: string;
  fecha: string | null;
  totalGuias: number;
  totalConPdf: number;
  guias: GuiaAgrupada[];
}

/**
 * Se acota por solicitudes, no por filas: cortar a N filas partiria la ultima
 * solicitud por la mitad y sus totales ("descargar las N guias") mentirian.
 */
export const MAX_SOLICITUDES = 60;

export async function obtenerHistorial(): Promise<SolicitudAgrupada[]> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas } = await supabase.from("empresas").select("id, nombre, codigo_interno");
  const { data: corridas } = await supabase
    .from("corridas")
    .select("id, empresa_id, archivo_original_nombre, fecha_ejecucion")
    .order("fecha_ejecucion", { ascending: false })
    .limit(MAX_SOLICITUDES);

  const idsCorridas = (corridas ?? []).map((c) => c.id);
  const filas =
    idsCorridas.length === 0
      ? []
      : await traerTodasLasFilas((desde, hasta) =>
          supabase
            .from("guias_generadas")
            .select(
              "corrida_id, categoria, centro, folio_relbase, estado, cantidad, mensaje_error, fecha_generacion, created_at, pdf_path"
            )
            .in("corrida_id", idsCorridas)
            .is("eliminado_en", null)
            .order("created_at", { ascending: false })
            .range(desde, hasta)
        );

  const empresaPorId = new Map((empresas ?? []).map((e) => [e.id, e]));
  const corridaPorId = new Map((corridas ?? []).map((c) => [c.id, c]));

  interface GuiaAcumulada {
    clave: string;
    folio: string | null;
    centro: string | null;
    categoria: string | null;
    estado: "generada" | "error";
    cantidadProductos: number;
    cantidadTotal: number;
    fecha: string | null;
    mensajeError: string | null;
    pdfPath: string | null;
  }

  // corridaId -> clave de guia -> filas agregadas
  const arbol = new Map<string, Map<string, GuiaAcumulada>>();

  for (const fila of filas) {
    if (!corridaPorId.has(fila.corrida_id)) continue;

    const clave = claveGuia(fila);

    if (!arbol.has(fila.corrida_id)) arbol.set(fila.corrida_id, new Map());
    const porGuia = arbol.get(fila.corrida_id)!;

    const existente = porGuia.get(clave);
    if (existente) {
      existente.cantidadProductos += 1;
      existente.cantidadTotal += Number(fila.cantidad);
      // Una guia partida en varios lotes puede tener filas con y sin PDF
      // guardado: basta con que una lo tenga.
      existente.pdfPath ??= fila.pdf_path;
    } else {
      porGuia.set(clave, {
        clave,
        folio: fila.folio_relbase,
        centro: fila.centro,
        categoria: fila.categoria,
        estado: fila.estado === "generada" ? "generada" : "error",
        cantidadProductos: 1,
        cantidadTotal: Number(fila.cantidad),
        fecha: fila.fecha_generacion ?? fila.created_at,
        mensajeError: fila.mensaje_error,
        pdfPath: fila.pdf_path,
      });
    }
  }

  const solicitudes: SolicitudAgrupada[] = [];

  for (const [corridaId, porGuia] of arbol) {
    const corrida = corridaPorId.get(corridaId)!;
    const empresa = empresaPorId.get(corrida.empresa_id);

    const acumuladas = [...porGuia.values()].sort(
      (a, b) =>
        (a.centro ?? "").localeCompare(b.centro ?? "") ||
        (a.categoria ?? "").localeCompare(b.categoria ?? "") ||
        (a.folio ?? "").localeCompare(b.folio ?? "")
    );

    const guias = await Promise.all(
      acumuladas.map(async (g) => {
        const nombreDescarga = construirNombreDescargaPdf(empresa?.nombre, g.centro, g.folio);
        const [pdfUrl, pdfUrlDescarga] = g.pdfPath
          ? await Promise.all([
              obtenerUrlFirmadaPdf(g.pdfPath),
              obtenerUrlFirmadaPdf(g.pdfPath, 3600, nombreDescarga),
            ])
          : [null, null];
        return {
          clave: g.clave,
          folio: g.folio,
          centro: g.centro,
          categoria: g.categoria,
          estado: g.estado,
          cantidadProductos: g.cantidadProductos,
          cantidadTotal: g.cantidadTotal,
          fecha: g.fecha,
          mensajeError: g.mensajeError,
          pdfUrl,
          pdfUrlDescarga,
        };
      })
    );

    solicitudes.push({
      corridaId,
      empresaCodigo: empresa?.codigo_interno ?? "—",
      empresaNombre: empresa?.nombre ?? empresa?.codigo_interno ?? "Empresa desconocida",
      archivo: corrida.archivo_original_nombre,
      fecha: corrida.fecha_ejecucion ?? acumuladas[0]?.fecha ?? null,
      totalGuias: guias.length,
      totalConPdf: acumuladas.filter((g) => g.pdfPath).length,
      guias,
    });
  }

  solicitudes.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));

  return solicitudes;
}
