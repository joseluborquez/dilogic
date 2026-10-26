/**
 * Fecha de hoy en Chile como dd-mm-aaaa (formato de Relbase). Con getDate()
 * se usaba la zona del servidor, que en Vercel es UTC: desde las 21:00 (20:00
 * en invierno) las guias salian con la fecha de manana.
 */
export function fechaHoyDDMMYYYY(): string {
  const partes = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("day")}-${valor("month")}-${valor("year")}`;
}
