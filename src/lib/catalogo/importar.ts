import "server-only";

import readXlsxFile from "read-excel-file/node";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface ResultadoImportacion {
  insertados: number;
  duplicadosOmitidos: number;
  sinPatronCategoria: number;
  advertencias: string[];
}

const ALIAS_CODIGO = ["codigo", "código", "sku", "codigo sku", "codigosku"];
const ALIAS_NOMBRE = ["nombre", "descripcion", "descripción", "producto", "detalle"];

function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Los SKUs de Dilogic siguen el patron EMPRESA_CATEGORIA_NUMERO (CERQ_AB_017).
 * La categoria del medio es la que decide en cuantas guias se parte un pedido,
 * asi que un catalogo que no siga el patron genera una sola guia por centro.
 */
function derivarFamilia(sku: string): string | null {
  const partes = sku.split("_");
  return partes.length === 3 ? partes[1] : null;
}

/**
 * Carga el catalogo de SKUs de una empresa desde un Excel con columnas de
 * codigo y nombre (mismo formato que CODIGOS DILOGIC.xlsx). Los product_id de
 * Relbase quedan en null: los completa la sincronizacion posterior.
 */
export async function importarCatalogoDesdeExcel(
  empresaId: string,
  archivo: Buffer
): Promise<ResultadoImportacion> {
  const filas = (await readXlsxFile(archivo)) as unknown as unknown[][];
  const advertencias: string[] = [];

  let indiceEncabezado = 0;
  while (
    indiceEncabezado < filas.length &&
    (filas[indiceEncabezado] ?? []).every((c) => c === null || c === undefined || c === "")
  ) {
    indiceEncabezado += 1;
  }

  const encabezado = (filas[indiceEncabezado] ?? []).map(normalizar);
  const idxCodigo = encabezado.findIndex((h) => ALIAS_CODIGO.includes(h));
  const idxNombre = encabezado.findIndex((h) => ALIAS_NOMBRE.includes(h));

  if (idxCodigo === -1) {
    throw new Error(
      'El archivo no tiene una columna de código. Debe llamarse "codigo" o "sku".'
    );
  }
  if (idxNombre === -1) {
    advertencias.push(
      'No se encontró columna de nombre: los productos quedan sin descripción hasta sincronizar con Relbase.'
    );
  }

  const vistos = new Set<string>();
  const registros: { empresa_id: string; sku: string; descripcion: string | null; familia: string | null; activo: boolean }[] = [];
  let duplicadosOmitidos = 0;
  let sinPatronCategoria = 0;

  for (const fila of filas.slice(indiceEncabezado + 1)) {
    const sku = String(fila?.[idxCodigo] ?? "").trim();
    if (!sku) continue;

    if (vistos.has(sku)) {
      duplicadosOmitidos += 1;
      continue;
    }
    vistos.add(sku);

    const familia = derivarFamilia(sku);
    if (!familia) sinPatronCategoria += 1;

    registros.push({
      empresa_id: empresaId,
      sku,
      descripcion: idxNombre === -1 ? null : String(fila?.[idxNombre] ?? "").trim() || null,
      familia,
      activo: true,
    });
  }

  if (registros.length === 0) {
    throw new Error("El archivo no tiene ningún código de producto.");
  }

  if (sinPatronCategoria > 0) {
    advertencias.push(
      `${sinPatronCategoria} código(s) no siguen el patrón EMPRESA_CATEGORIA_NUMERO (ej. CERQ_AB_017). Los pedidos de esos productos no se van a separar por categoría.`
    );
  }
  if (duplicadosOmitidos > 0) {
    advertencias.push(`Se omitieron ${duplicadosOmitidos} código(s) repetidos.`);
  }

  // upsert e ignoreDuplicates: productos_catalogo tiene unique (empresa_id,
  // sku), asi que volver a cargar el mismo archivo no falla ni duplica.
  const supabase = getSupabaseServiceClient();
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from("productos_catalogo")
      .upsert(registros.slice(i, i + 500), {
        onConflict: "empresa_id,sku",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`No se pudo guardar el catálogo: ${error.message}`);
  }

  return {
    insertados: registros.length,
    duplicadosOmitidos,
    sinPatronCategoria,
    advertencias,
  };
}
