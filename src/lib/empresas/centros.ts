import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Centros por revisar (17-11-2026): contactos nuevos de Cermaq, Multiexport y Yadran que la sincronizacion agrego
 * a la lista oficial con una decision automatica. Hugo los confirma en Empresas; la lista la usa tambien el buscador.
 */
export interface CentroPorRevisar {
  id: number;
  empresa: string;
  contacto: string;
  centro: string;
  tipo: "centro" | "otros" | "bins" | "fuera" | "traspaso";
  /** Centros ya confirmados de la misma empresa, para «Juntar con…». */
  existentes: string[];
}

export async function centrosPorRevisar(): Promise<CentroPorRevisar[]> {
  const supabase = getSupabaseServiceClient();
  const [{ data: pendientes, error }, { data: todos }, { data: empresas }] = await Promise.all([
    supabase.from("centros").select("id, customer_id, contacto, centro, tipo").eq("revisado", false).order("creado_en"),
    supabase.from("centros").select("customer_id, centro").eq("revisado", true).eq("tipo", "centro"),
    supabase.from("empresas").select("nombre, relbase_customer_id"),
  ]);
  if (error) throw new Error(`No se pudo leer la lista de centros: ${error.message}`);
  const nombreEmpresa = new Map((empresas ?? []).map((e) => [Number(e.relbase_customer_id), e.nombre]));
  return (pendientes ?? []).map((p) => ({
    id: Number(p.id),
    empresa: nombreEmpresa.get(Number(p.customer_id)) ?? `Cliente ${p.customer_id}`,
    contacto: p.contacto,
    centro: p.centro,
    tipo: p.tipo,
    existentes: [
      ...new Set((todos ?? []).filter((t) => Number(t.customer_id) === Number(p.customer_id)).map((t) => t.centro)),
    ].sort((a, b) => a.localeCompare(b, "es")),
  }));
}
