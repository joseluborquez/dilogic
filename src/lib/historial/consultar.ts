import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { obtenerUrlFirmadaPdf } from "@/lib/storage/guias-pdf";

export interface GuiaAgrupada {
  folio: string | null;
  centro: string | null;
  estado: "generada" | "error";
  cantidadProductos: number;
  cantidadTotal: number;
  fecha: string | null;
  mensajeError: string | null;
  pdfUrl: string | null;
}

export interface CategoriaAgrupada {
  categoria: string | null;
  guias: GuiaAgrupada[];
}

export interface EmpresaAgrupada {
  empresaCodigo: string;
  empresaNombre: string;
  categorias: CategoriaAgrupada[];
}

const MAX_GUIAS = 2000;

export async function obtenerHistorial(): Promise<EmpresaAgrupada[]> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas } = await supabase.from("empresas").select("id, nombre, codigo_interno");
  const { data: corridas } = await supabase.from("corridas").select("id, empresa_id");
  const { data: filas } = await supabase
    .from("guias_generadas")
    .select(
      "corrida_id, categoria, centro, folio_relbase, estado, cantidad, mensaje_error, fecha_generacion, created_at, pdf_path"
    )
    .order("created_at", { ascending: false })
    .limit(MAX_GUIAS);

  const empresaPorId = new Map((empresas ?? []).map((e) => [e.id, e]));
  const empresaIdPorCorridaId = new Map((corridas ?? []).map((c) => [c.id, c.empresa_id]));

  // empresaCodigo -> categoria -> claveGuia -> filas agregadas
  const arbol = new Map<
    string,
    Map<
      string | null,
      Map<
        string,
        {
          folio: string | null;
          centro: string | null;
          estado: "generada" | "error";
          cantidadProductos: number;
          cantidadTotal: number;
          fecha: string | null;
          mensajeError: string | null;
          pdfPath: string | null;
        }
      >
    >
  >();

  for (const fila of filas ?? []) {
    const empresaId = empresaIdPorCorridaId.get(fila.corrida_id);
    const empresa = empresaId ? empresaPorId.get(empresaId) : undefined;
    if (!empresa) continue;

    const claveGuia =
      fila.estado === "generada"
        ? `folio:${fila.folio_relbase}`
        : `error:${fila.corrida_id}:${fila.categoria ?? ""}:${fila.mensaje_error ?? ""}`;

    if (!arbol.has(empresa.codigo_interno)) arbol.set(empresa.codigo_interno, new Map());
    const porCategoria = arbol.get(empresa.codigo_interno)!;

    if (!porCategoria.has(fila.categoria)) porCategoria.set(fila.categoria, new Map());
    const porGuia = porCategoria.get(fila.categoria)!;

    const existente = porGuia.get(claveGuia);
    if (existente) {
      existente.cantidadProductos += 1;
      existente.cantidadTotal += Number(fila.cantidad);
    } else {
      porGuia.set(claveGuia, {
        folio: fila.folio_relbase,
        centro: fila.centro,
        estado: fila.estado === "generada" ? "generada" : "error",
        cantidadProductos: 1,
        cantidadTotal: Number(fila.cantidad),
        fecha: fila.fecha_generacion ?? fila.created_at,
        mensajeError: fila.mensaje_error,
        pdfPath: fila.pdf_path,
      });
    }
  }

  const resultado: EmpresaAgrupada[] = [];

  for (const [empresaCodigo, porCategoria] of arbol) {
    const empresa = [...empresaPorId.values()].find((e) => e.codigo_interno === empresaCodigo);
    const categorias: CategoriaAgrupada[] = [];

    for (const [categoria, porGuia] of porCategoria) {
      const guias = await Promise.all(
        [...porGuia.values()]
          .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""))
          .map(async (g) => ({
            folio: g.folio,
            centro: g.centro,
            estado: g.estado,
            cantidadProductos: g.cantidadProductos,
            cantidadTotal: g.cantidadTotal,
            fecha: g.fecha,
            mensajeError: g.mensajeError,
            pdfUrl: g.pdfPath ? await obtenerUrlFirmadaPdf(g.pdfPath) : null,
          }))
      );
      categorias.push({ categoria, guias });
    }

    categorias.sort((a, b) => (a.categoria ?? "").localeCompare(b.categoria ?? ""));

    resultado.push({
      empresaCodigo,
      empresaNombre: empresa?.nombre ?? empresaCodigo,
      categorias,
    });
  }

  resultado.sort((a, b) => a.empresaCodigo.localeCompare(b.empresaCodigo));

  return resultado;
}
