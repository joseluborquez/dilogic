import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";

const BUCKET = "guias-pdf";

function slug(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sin-categoria";
}

/**
 * Descarga el PDF desde la URL firmada de Relbase (expira ~1h) y lo sube al
 * bucket privado guias-pdf, organizado por empresa/centro/categoria/folio.
 * Devuelve la ruta dentro del bucket (no una URL firmada: esas se generan al
 * vuelo al mostrar el historial, ver src/app/historial/actions.ts).
 */
export async function guardarPdfGuia(params: {
  empresaCodigo: string;
  categoria: string | null;
  centro: string | null;
  folio: string;
  pdfUrl: string;
}): Promise<string> {
  const { empresaCodigo, categoria, centro, folio, pdfUrl } = params;

  const res = await fetch(pdfUrl);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el PDF de Relbase (${res.status}).`);
  }
  const bytes = await res.arrayBuffer();

  const path = centro
    ? `${slug(empresaCodigo)}/${slug(centro)}/${slug(categoria ?? "sin-categoria")}/${folio}.pdf`
    : `${slug(empresaCodigo)}/${slug(categoria ?? "sin-categoria")}/${folio}.pdf`;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/**
 * Baja el PDF desde el bucket privado, para armarlo dentro de un ZIP. Devuelve
 * null si el archivo ya no esta (no rompe la descarga masiva: la guia se
 * reporta como faltante).
 */
export async function descargarPdfGuia(path: string): Promise<Uint8Array | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function obtenerUrlFirmadaPdf(
  path: string,
  expiraEnSegundos = 3600,
  // Si se entrega, la URL fuerza la descarga con este nombre de archivo
  // (Content-Disposition), para que el PDF bajado identifique empresa/contacto
  // en vez de llamarse solo por el folio. Sin esto, la URL se ve inline.
  nombreDescarga?: string
): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      path,
      expiraEnSegundos,
      nombreDescarga ? { download: nombreDescarga } : undefined
    );
  if (error) return null;
  return data.signedUrl;
}
