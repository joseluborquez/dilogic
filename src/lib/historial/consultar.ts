import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
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
  /**
   * Si tiene PDF guardado. La URL no se firma aqui: firmar por adelantado
   * costaba dos llamadas a Storage por guia en cada carga de pagina. Los
   * enlaces apuntan a /api/guias/pdf, que firma al momento del click.
   */
  tienePdf: boolean;
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
 * Se pagina por solicitudes, no por filas: cortar a N filas partiria la ultima
 * solicitud por la mitad y sus totales ("descargar las N guias") mentirian.
 */
export const SOLICITUDES_POR_PAGINA = 25;

/**
 * Tope de filas que revisa la busqueda por texto. Se recorren de la mas
 * reciente hacia atras, asi que una busqueda amplia ("MELCHOR") encuentra
 * primero lo ultimo, que es lo que se busca en la practica.
 */
const MAX_FILAS_BUSQUEDA = 5000;

export interface FiltrosHistorial {
  /** Folio o centro, parcial. */
  texto?: string;
  /** codigo_interno de la empresa (CERQ / MTX / YDR). */
  empresa?: string;
  desde?: string; // yyyy-mm-dd
  hasta?: string; // yyyy-mm-dd
  pagina?: number; // 1-based
}

export interface ResultadoHistorial {
  solicitudes: SolicitudAgrupada[];
  pagina: number;
  totalPaginas: number;
  totalSolicitudes: number;
  hayFiltros: boolean;
}

/**
 * El texto entra a un `or(...ilike...)` de PostgREST, cuya sintaxis separa por
 * comas y parentesis: se limita a letras, numeros y separadores corrientes
 * para que la busqueda no pueda alterar la consulta.
 */
function limpiarTexto(texto: string): string {
  return texto
    .trim()
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, "")
    .slice(0, 60)
    .trim();
}

function coincide(texto: string, guia: { folio: string | null; centro: string | null }): boolean {
  const buscado = texto.toLowerCase();
  return (
    (guia.folio ?? "").toLowerCase().includes(buscado) ||
    (guia.centro ?? "").toLowerCase().includes(buscado)
  );
}

export async function obtenerHistorial(
  filtros: FiltrosHistorial = {}
): Promise<ResultadoHistorial> {
  const supabase = getSupabaseServiceClient();

  const texto = filtros.texto ? limpiarTexto(filtros.texto) : "";
  const pagina = Math.max(1, filtros.pagina ?? 1);
  const hayFiltros = Boolean(texto || filtros.empresa || filtros.desde || filtros.hasta);
  const vacio: ResultadoHistorial = {
    solicitudes: [],
    pagina,
    totalPaginas: 0,
    totalSolicitudes: 0,
    hayFiltros,
  };

  const { data: empresas } = await supabase.from("empresas").select("id, nombre, codigo_interno");

  let consulta = supabase
    .from("corridas")
    .select("id, empresa_id, archivo_original_nombre, fecha_ejecucion", { count: "exact" });

  if (filtros.empresa) {
    const empresa = (empresas ?? []).find((e) => e.codigo_interno === filtros.empresa);
    if (!empresa) return vacio;
    consulta = consulta.eq("empresa_id", empresa.id);
  }
  if (filtros.desde) consulta = consulta.gte("fecha_ejecucion", `${filtros.desde}T00:00:00`);
  if (filtros.hasta) consulta = consulta.lte("fecha_ejecucion", `${filtros.hasta}T23:59:59`);

  // La busqueda por folio/centro vive en las guias, pero la unidad que se
  // pagina es la solicitud: primero se resuelve que solicitudes la contienen.
  if (texto) {
    const { data: coincidencias } = await supabase
      .from("guias_generadas")
      .select("corrida_id")
      .or(`folio_relbase.ilike.*${texto}*,centro.ilike.*${texto}*`)
      .is("eliminado_en", null)
      .order("created_at", { ascending: false })
      .limit(MAX_FILAS_BUSQUEDA);

    const ids = [...new Set((coincidencias ?? []).map((c) => c.corrida_id))];
    if (ids.length === 0) return vacio;
    consulta = consulta.in("id", ids);
  }

  const desde = (pagina - 1) * SOLICITUDES_POR_PAGINA;
  const { data: corridas, count } = await consulta
    .order("fecha_ejecucion", { ascending: false })
    .range(desde, desde + SOLICITUDES_POR_PAGINA - 1);

  const totalSolicitudes = count ?? 0;
  const idsCorridas = (corridas ?? []).map((c) => c.id);
  if (idsCorridas.length === 0) {
    return { ...vacio, totalSolicitudes, totalPaginas: Math.ceil(totalSolicitudes / SOLICITUDES_POR_PAGINA) };
  }
  const filas = await traerTodasLasFilas((inicio, fin) =>
    supabase
      .from("guias_generadas")
      .select(
        "corrida_id, categoria, centro, folio_relbase, estado, cantidad, mensaje_error, fecha_generacion, created_at, pdf_path"
      )
      .in("corrida_id", idsCorridas)
      .is("eliminado_en", null)
      .order("created_at", { ascending: false })
      .range(inicio, fin)
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

    // Con busqueda por texto se muestran solo las guias que coinciden: si se
    // busca un folio, la solicitud aparece con esa guia, no con las 14 que la
    // acompanaban. Los botones de descarga usan las guias visibles, asi que lo
    // que se baja es siempre lo que esta en pantalla.
    const visibles = texto
      ? [...porGuia.values()].filter((g) => coincide(texto, g))
      : [...porGuia.values()];
    if (visibles.length === 0) continue;

    const acumuladas = visibles.sort(
      (a, b) =>
        (a.centro ?? "").localeCompare(b.centro ?? "") ||
        (a.categoria ?? "").localeCompare(b.categoria ?? "") ||
        (a.folio ?? "").localeCompare(b.folio ?? "")
    );

    const guias: GuiaAgrupada[] = acumuladas.map((g) => ({
      clave: g.clave,
      folio: g.folio,
      centro: g.centro,
      categoria: g.categoria,
      estado: g.estado,
      cantidadProductos: g.cantidadProductos,
      cantidadTotal: g.cantidadTotal,
      fecha: g.fecha,
      mensajeError: g.mensajeError,
      tienePdf: Boolean(g.pdfPath),
    }));

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

  return {
    solicitudes,
    pagina,
    totalSolicitudes,
    totalPaginas: Math.ceil(totalSolicitudes / SOLICITUDES_POR_PAGINA),
    hayFiltros,
  };
}

/** Empresas con al menos una solicitud, para el selector del buscador. */
export async function obtenerEmpresasConHistorial(): Promise<
  { codigo: string; nombre: string }[]
> {
  const supabase = getSupabaseServiceClient();
  const { data: empresas } = await supabase
    .from("empresas")
    .select("id, nombre, codigo_interno")
    .order("nombre");
  const { data: corridas } = await supabase.from("corridas").select("empresa_id");

  const conHistorial = new Set((corridas ?? []).map((c) => c.empresa_id));
  return (empresas ?? [])
    .filter((e) => conHistorial.has(e.id))
    .map((e) => ({ codigo: e.codigo_interno, nombre: e.nombre }));
}
