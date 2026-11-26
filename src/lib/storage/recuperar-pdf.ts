import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { guardarPdfGuia } from "@/lib/storage/guias-pdf";
import { obtenerPdfUrlDte } from "@/lib/relbase/client";

/**
 * Pide de nuevo a Relbase el PDF de una guia emitida que quedo sin el (al
 * generarla Relbase a veces aun no lo tiene listo), lo guarda en el bucket y
 * anota la ruta en todas sus filas. Solo lee de Relbase (GET): no emite nada.
 * Devuelve la ruta, o null si Relbase todavia no lo entrega o algo falla.
 */
export async function recuperarPdfGuia(guia: {
  corridaId: string;
  folio: string;
  dteId: number;
  empresaCodigo: string;
  categoria: string | null;
  centro: string | null;
}): Promise<string | null> {
  try {
    const url = await obtenerPdfUrlDte(guia.dteId, { intentos: 2 });
    if (!url) return null;
    const path = await guardarPdfGuia({
      empresaCodigo: guia.empresaCodigo,
      categoria: guia.categoria,
      centro: guia.centro,
      folio: guia.folio,
      pdfUrl: url,
    });
    await getSupabaseServiceClient()
      .from("guias_generadas")
      .update({ pdf_path: path })
      .eq("corrida_id", guia.corridaId)
      .eq("folio_relbase", guia.folio);
    return path;
  } catch (err) {
    console.error(`No se pudo recuperar el PDF del folio ${guia.folio}`, err);
    return null;
  }
}
