import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";

/** Un traspaso ya emitido (una corrida): sus facturas y las guias que salieron. */
export interface TraspasoAnterior {
  corridaId: string;
  fecha: string;
  centro: string;
  empresa: string;
  facturas: string[];
  neto: number;
  guias: { folio: string; tienePdf: boolean }[];
  conError: number;
}

export const TRASPASOS_A_MOSTRAR = 10;

/** Los ultimos traspasos, del mas reciente al mas antiguo, para la pantalla de Traspaso. */
export async function traspasosAnteriores(): Promise<TraspasoAnterior[]> {
  const supabase = getSupabaseServiceClient();
  // Una fila por factura: con 10 traspasos de hasta ~10 facturas, 200 alcanzan.
  const { data: facturas } = await supabase
    .from("traspasos_factura")
    .select("folio, neto, centro, created_at, corrida_id, empresa_id")
    .not("corrida_id", "is", null)
    .order("created_at", { ascending: false })
    .order("folio", { ascending: true })
    .limit(200);

  const porCorrida = new Map<string, NonNullable<typeof facturas>>();
  for (const f of facturas ?? []) {
    const lista = porCorrida.get(f.corrida_id!) ?? [];
    if (!lista.length && porCorrida.size >= TRASPASOS_A_MOSTRAR) continue;
    lista.push(f);
    porCorrida.set(f.corrida_id!, lista);
  }
  const ids = [...porCorrida.keys()];
  if (!ids.length) return [];

  const [filas, { data: empresas }] = await Promise.all([
    // Una fila por linea de guia: se juntan por folio abajo.
    traerTodasLasFilas((desde, hasta) =>
      supabase
        .from("guias_generadas")
        .select("id, corrida_id, folio_relbase, estado, pdf_path")
        .in("corrida_id", ids)
        .is("eliminado_en", null)
        .order("id", { ascending: true })
        .range(desde, hasta)
    ),
    supabase.from("empresas").select("id, nombre, codigo_interno"),
  ]);
  const empresaPorId = new Map((empresas ?? []).map((e) => [e.id, e.nombre ?? e.codigo_interno]));

  return ids.map((corridaId) => {
    const fs = porCorrida.get(corridaId)!;
    const guias = new Map<string, boolean>();
    let conError = 0;
    for (const g of filas) {
      if (g.corrida_id !== corridaId) continue;
      if (g.estado !== "generada" || !g.folio_relbase) {
        conError += 1;
        continue;
      }
      guias.set(g.folio_relbase, (guias.get(g.folio_relbase) ?? false) || Boolean(g.pdf_path));
    }
    return {
      corridaId,
      fecha: fs[0].created_at,
      centro: fs[0].centro,
      empresa: empresaPorId.get(fs[0].empresa_id) ?? "—",
      facturas: fs.map((f) => f.folio).sort(),
      neto: fs.reduce((t, f) => t + Number(f.neto), 0),
      guias: [...guias].map(([folio, tienePdf]) => ({ folio, tienePdf })).sort((a, b) => a.folio.localeCompare(b.folio)),
      conError,
    };
  });
}
