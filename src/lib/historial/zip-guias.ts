import "server-only";

import { zipSync, strToU8 } from "fflate";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { descargarPdfGuia } from "@/lib/storage/guias-pdf";
import { claveGuia, corridasDeClaves } from "./claves";
import { construirNombreDescargaPdf, construirNombreZipSolicitud } from "./nombre-pdf";

export class ErrorZip extends Error {}

export interface ResultadoZip {
  bytes: Uint8Array;
  nombreArchivo: string;
  incluidas: number;
  faltantes: number;
}

// Topes para no reventar el limite de memoria/tiempo de una funcion serverless
// en Vercel. Sobre esto, el operador tiene que dividir la seleccion.
const MAX_GUIAS_POR_ZIP = 150;
const MAX_BYTES_POR_ZIP = 40 * 1024 * 1024;
const DESCARGAS_EN_PARALELO = 6;

interface GuiaParaZip {
  clave: string;
  corridaId: string;
  folio: string | null;
  centro: string | null;
  estado: "generada" | "error";
  mensajeError: string | null;
  pdfPath: string | null;
}

/** Todas las claves de guia (no eliminadas) de una solicitud. */
export async function clavesDeCorrida(corridaId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("guias_generadas")
      .select("corrida_id, folio_relbase, estado, categoria, centro, mensaje_error")
      .eq("corrida_id", corridaId)
      .is("eliminado_en", null)
      .order("created_at", { ascending: true })
      .range(desde, hasta)
  );

  return [...new Set(filas.map(claveGuia))];
}

/**
 * Resuelve una seleccion de claves contra la base. Nunca confia en el detalle
 * que manda el cliente: recalcula las claves desde las filas reales y se queda
 * solo con las que coinciden.
 */
async function resolverGuias(claves: string[]): Promise<GuiaParaZip[]> {
  const corridas = corridasDeClaves(claves);
  if (corridas.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("guias_generadas")
      .select("corrida_id, folio_relbase, estado, categoria, centro, mensaje_error, pdf_path")
      .in("corrida_id", corridas)
      .is("eliminado_en", null)
      .order("created_at", { ascending: true })
      .range(desde, hasta)
  );

  const pedidas = new Set(claves);
  const porClave = new Map<string, GuiaParaZip>();

  for (const fila of filas) {
    const clave = claveGuia(fila);
    if (!pedidas.has(clave)) continue;
    const existente = porClave.get(clave);
    if (existente) {
      existente.pdfPath ??= fila.pdf_path;
      continue;
    }
    porClave.set(clave, {
      clave,
      corridaId: fila.corrida_id,
      folio: fila.folio_relbase,
      centro: fila.centro,
      estado: fila.estado === "generada" ? "generada" : "error",
      mensajeError: fila.mensaje_error,
      pdfPath: fila.pdf_path,
    });
  }

  return [...porClave.values()];
}

async function enLotes<T, R>(
  items: T[],
  tamano: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += tamano) {
    salida.push(...(await Promise.all(items.slice(i, i + tamano).map(fn))));
  }
  return salida;
}

/** Evita que dos guias con el mismo nombre se pisen dentro del ZIP. */
function nombreUnico(nombre: string, usados: Set<string>): string {
  if (!usados.has(nombre)) {
    usados.add(nombre);
    return nombre;
  }
  const base = nombre.replace(/\.pdf$/i, "");
  let n = 2;
  while (usados.has(`${base} (${n}).pdf`)) n += 1;
  const unico = `${base} (${n}).pdf`;
  usados.add(unico);
  return unico;
}

export async function construirZipGuias(claves: string[]): Promise<ResultadoZip> {
  const guias = await resolverGuias(claves);

  if (guias.length === 0) {
    throw new ErrorZip("No se encontraron guías para descargar.");
  }
  if (guias.length > MAX_GUIAS_POR_ZIP) {
    throw new ErrorZip(
      `La selección tiene ${guias.length} guías y el máximo por descarga es ${MAX_GUIAS_POR_ZIP}. Selecciona menos guías y descarga en dos veces.`
    );
  }

  const supabase = getSupabaseServiceClient();
  const corridasIds = [...new Set(guias.map((g) => g.corridaId))];
  const { data: corridas } = await supabase
    .from("corridas")
    .select("id, empresa_id, archivo_original_nombre, fecha_ejecucion")
    .in("id", corridasIds);
  const { data: empresas } = await supabase.from("empresas").select("id, nombre");

  const empresaPorId = new Map((empresas ?? []).map((e) => [e.id, e.nombre]));
  const corridaPorId = new Map((corridas ?? []).map((c) => [c.id, c]));

  const descargadas = await enLotes(guias, DESCARGAS_EN_PARALELO, async (guia) => ({
    guia,
    bytes: guia.pdfPath ? await descargarPdfGuia(guia.pdfPath) : null,
  }));

  const archivos: Record<string, Uint8Array> = {};
  const usados = new Set<string>();
  const faltantes: string[] = [];
  let total = 0;

  for (const { guia, bytes } of descargadas) {
    const empresaNombre = empresaPorId.get(corridaPorId.get(guia.corridaId)?.empresa_id ?? "");

    if (!bytes) {
      const motivo =
        guia.estado === "error"
          ? `no se llegó a emitir (${guia.mensajeError ?? "error desconocido"})`
          : guia.pdfPath
            ? "el PDF ya no está en el almacenamiento"
            : "Relbase no alcanzó a entregar el PDF al generarla";
      faltantes.push(
        `${[empresaNombre, guia.centro, guia.folio].filter(Boolean).join(" - ") || guia.clave}: ${motivo}`
      );
      continue;
    }

    total += bytes.byteLength;
    if (total > MAX_BYTES_POR_ZIP) {
      throw new ErrorZip(
        "La selección pesa más de 40 MB. Selecciona menos guías y descarga en dos veces."
      );
    }

    const nombre = nombreUnico(
      construirNombreDescargaPdf(empresaNombre, guia.centro, guia.folio),
      usados
    );
    archivos[nombre] = bytes;
  }

  if (faltantes.length > 0) {
    archivos["_guias-sin-pdf.txt"] = strToU8(
      [
        "Estas guías de la selección no tienen PDF disponible:",
        "",
        ...faltantes.map((f) => `- ${f}`),
        "",
        "Las guías emitidas siguen existiendo en Relbase: puedes descargar su PDF desde allí.",
        "",
      ].join("\n")
    );
  }

  if (Object.keys(archivos).length === 0) {
    throw new ErrorZip("Ninguna de las guías seleccionadas tiene PDF para descargar.");
  }

  const unicaCorrida = corridasIds.length === 1 ? corridaPorId.get(corridasIds[0]) : undefined;
  const nombreArchivo = unicaCorrida
    ? construirNombreZipSolicitud(
        empresaPorId.get(unicaCorrida.empresa_id),
        unicaCorrida.archivo_original_nombre,
        unicaCorrida.fecha_ejecucion
      )
    : `Guias Dilogic - ${new Date().toISOString().slice(0, 10)}.zip`;

  // level 0 (sin comprimir): los PDF ya vienen comprimidos, recomprimirlos solo
  // gasta CPU de la funcion serverless sin ganar espacio.
  const bytes = zipSync(archivos, { level: 0 });

  return {
    bytes,
    nombreArchivo,
    incluidas: Object.keys(archivos).length - (faltantes.length > 0 ? 1 : 0),
    faltantes: faltantes.length,
  };
}
