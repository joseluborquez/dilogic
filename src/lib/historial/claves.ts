import type { GuiaGenerada } from "@/lib/supabase/types";

/**
 * En `guias_generadas` hay una fila por SKU, no por documento: el documento
 * real es el conjunto de filas que comparten corrida + folio. Esta clave
 * identifica ese documento y es la unidad sobre la que operan la seleccion,
 * la descarga masiva y la eliminacion.
 *
 * Las filas en error no tienen folio (la guia nunca se creo en Relbase): se
 * agrupan por corrida + categoria + centro + mensaje, igual que en pantalla.
 *
 * Formato: "<tipo>:<corridaId>:<resto>". El corridaId es un uuid (sin ":"),
 * asi que siempre se puede recuperar con corridaIdDeClave; el resto no se
 * parsea nunca — el servidor recalcula las claves desde la base y compara,
 * en vez de confiar en lo que llega del cliente.
 */
export type FilaConClave = Pick<
  GuiaGenerada,
  "corrida_id" | "folio_relbase" | "estado" | "categoria" | "centro" | "mensaje_error"
>;

export function claveGuia(fila: FilaConClave): string {
  if (fila.estado === "generada" && fila.folio_relbase) {
    return `g:${fila.corrida_id}:${fila.folio_relbase}`;
  }
  return `e:${fila.corrida_id}:${fila.categoria ?? ""}|${fila.centro ?? ""}|${
    fila.mensaje_error ?? ""
  }`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extrae la corrida de una clave, o null si la clave no tiene forma valida. */
export function corridaIdDeClave(clave: string): string | null {
  const partes = clave.split(":");
  if (partes.length < 3) return null;
  return UUID.test(partes[1]) ? partes[1] : null;
}

/** Corridas involucradas en una seleccion, sin repetir. */
export function corridasDeClaves(claves: string[]): string[] {
  const ids = new Set<string>();
  for (const clave of claves) {
    const id = corridaIdDeClave(clave);
    if (id) ids.add(id);
  }
  return [...ids];
}
