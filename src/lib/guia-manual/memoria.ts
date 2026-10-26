import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { claveMemoria } from "@/lib/listado-cliente/cruce";

/**
 * Memoria de la guia manual (tabla memoria_listados): texto del cliente ->
 * producto con que salio en una guia emitida. Si la tabla aun no existe o
 * falla la lectura, la guia sigue funcionando sin memoria.
 */
export interface Recuerdo {
  texto: string;
  codigo: string;
  veces: number;
}

export async function cargarMemoria(): Promise<Recuerdo[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("memoria_listados")
    .select("texto, codigo, veces")
    .order("texto")
    .range(0, 9999);
  if (error) return [];
  return data ?? [];
}

/**
 * Guarda lo emitido: cada texto queda con el ultimo producto elegido y cuantas
 * veces se ha usado. Lanza si falla; quien emite guias lo ignora (la memoria
 * nunca debe hacer fallar una guia ya emitida).
 */
export async function recordar(pares: { texto: string; codigo: string; productId: number | null }[], usuario: string | null): Promise<void> {
  const porClave = new Map<string, { texto: string; codigo: string; productId: number | null }>();
  for (const p of pares) {
    const clave = claveMemoria(p.texto);
    if (clave) porClave.set(clave, p);
  }
  if (porClave.size === 0) return;
  const supabase = getSupabaseServiceClient();
  const claves = [...porClave.keys()];
  // De a 50: cientos de textos en un solo filtro hacen una URL demasiado larga.
  const antes = new Map<string, { codigo: string; veces: number }>();
  for (let i = 0; i < claves.length; i += 50) {
    const { data, error } = await supabase.from("memoria_listados").select("texto, codigo, veces").in("texto", claves.slice(i, i + 50));
    if (error) throw new Error(`No se pudo leer la memoria: ${error.message}`);
    for (const r of data ?? []) antes.set(r.texto, r);
  }
  const { error } = await supabase.from("memoria_listados").upsert(
    [...porClave.entries()].map(([clave, p]) => {
      const previo = antes.get(clave);
      return {
        texto: clave,
        texto_original: p.texto.slice(0, 300),
        codigo: p.codigo,
        product_id: p.productId,
        // Si cambio el producto, la cuenta parte de nuevo.
        veces: previo && previo.codigo === p.codigo ? previo.veces + 1 : 1,
        usuario,
        actualizado_en: new Date().toISOString(),
      };
    })
  );
  if (error) throw new Error(`No se pudo guardar la memoria: ${error.message}`);
}
