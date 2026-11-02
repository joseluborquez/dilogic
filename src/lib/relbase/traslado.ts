import type { RelbaseCrearDtePayload } from "./types";

/**
 * Datos de despacho y transporte que Relbase exige en toda guia desde el
 * 01-11-2026 (Res. Ex. N°154/2025): sin ellos responde 422. Dilogic usa
 * siempre los mismos (definido por Hugo el 02-11-2026, igual que el folio
 * 41076): destino = direccion del documento, sin carro, salida = momento de
 * emision y llegada el mismo dia. Patente, transportista y chofer NO se
 * marcan "no se cuenta" (Hugo, 02-11-2026: asi el PDF no imprime las lineas
 * "SIN INFORMACION"). Si Relbase los exigiera, responde 422 sin emitir.
 */
export type DatosTraslado = Pick<
  RelbaseCrearDtePayload,
  | "dispatch_address"
  | "dispatch_city_id"
  | "dispatch_commune_id"
  | "trailer_plate_status"
  | "departure_date"
  | "departure_time"
  | "arrival_date"
>;

/** Fecha (AAAA-MM-DD) y hora (HH:MM:SS) actuales en Chile, no en la zona del servidor (UTC en Vercel). */
function ahoraEnChile(ahora: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}:${v("second")}` };
}

export function datosTrasladoFijos(
  destino: { address: string; city_id: number; commune_id: number },
  ahora: Date = new Date()
): DatosTraslado {
  const { fecha, hora } = ahoraEnChile(ahora);
  return {
    dispatch_address: destino.address,
    dispatch_city_id: destino.city_id,
    dispatch_commune_id: destino.commune_id,
    trailer_plate_status: "no_trailer",
    departure_date: fecha,
    departure_time: hora,
    arrival_date: fecha,
  };
}
