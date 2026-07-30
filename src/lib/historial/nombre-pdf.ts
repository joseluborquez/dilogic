/**
 * Nombre con el que se descarga el PDF de una guia, para identificar el
 * documento sin abrirlo (requisito: saber empresa / contacto al descargar).
 * Ej: "Multiexport - QUEMADA - 39684.pdf". El contacto (centro) puede faltar
 * en guias antiguas de formato largo, en cuyo caso se omite.
 *
 * Se usa igual en la descarga individual (Content-Disposition de la URL
 * firmada) y en los nombres de entrada del ZIP masivo.
 */
export function construirNombreDescargaPdf(
  empresaNombre: string | undefined,
  centro: string | null,
  folio: string | null
): string {
  const base = [empresaNombre, centro, folio]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ") // caracteres invalidos en nombres de archivo
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "guia"}.pdf`;
}

/** Igual que el anterior pero para el ZIP de una solicitud completa. */
export function construirNombreZipSolicitud(
  empresaNombre: string | undefined,
  archivo: string | null,
  fechaIso: string | null
): string {
  const fecha = fechaIso ? fechaIso.slice(0, 10) : null;
  const archivoSinExtension = archivo?.replace(/\.(xlsx?|csv)$/i, "") ?? null;
  const base = [empresaNombre, archivoSinExtension, fecha]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "guias"}.zip`;
}
