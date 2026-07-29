"use server";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto/tokens";
import { crearGuiaDespacho, obtenerPdfUrlDte, RelbaseApiError } from "@/lib/relbase/client";
import {
  TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
  type RelbaseCredenciales,
} from "@/lib/relbase/types";
import { guardarPdfGuia } from "@/lib/storage/guias-pdf";
import { EMPRESAS } from "./empresas";

interface FilaAGenerar {
  fila: number;
  codigo: string;
  cantidad: number;
  categoria: string | null;
  centro: string | null;
  productIdRelbase: number;
  precio: number;
  descripcionUnidad: string | null;
}

export interface ResultadoGrupo {
  centro: string;
  categoria: string | null;
  filas: number[];
  estado: "generada" | "error";
  folio: string | null;
  mensajeError: string | null;
}

export type EstadoGeneracion =
  | { status: "inicial" }
  | { status: "error"; mensaje: string }
  | {
      status: "ok";
      corridaId: string;
      grupos: ResultadoGrupo[];
    };

function fechaHoyDDMMYYYY(): string {
  const hoy = new Date();
  const dd = String(hoy.getDate()).padStart(2, "0");
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${hoy.getFullYear()}`;
}

interface GrupoCentroCategoria {
  centro: string;
  categoria: string | null;
  filas: FilaAGenerar[];
}

// Agrupa por centro (contacto de la guia) y luego por categoria: cada
// combinacion se traduce en una o mas guias (ver MAX_PRODUCTOS_POR_DOCUMENTO).
// En archivos formato matriz el centro viene del propio archivo (columna);
// en formato largo viene del campo "contacto" ingresado a mano y es el mismo
// para todas las filas.
function agruparPorCentroYCategoria(
  filas: FilaAGenerar[],
  contactoManual: string
): GrupoCentroCategoria[] {
  const grupos = new Map<string, GrupoCentroCategoria>();
  for (const fila of filas) {
    const centro = fila.centro ?? contactoManual;
    const clave = `${centro}::${fila.categoria ?? ""}`;
    if (!grupos.has(clave)) grupos.set(clave, { centro, categoria: fila.categoria, filas: [] });
    grupos.get(clave)!.filas.push(fila);
  }
  return [...grupos.values()];
}

// Relbase rechaza cualquier documento electronico con mas de 60 productos:
// un grupo (categoria) que exceda ese tamano debe partirse en varias guias.
const MAX_PRODUCTOS_POR_DOCUMENTO = 60;

function dividirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

export async function generarGuiasAction(
  _prevState: EstadoGeneracion,
  formData: FormData
): Promise<EstadoGeneracion> {
  const empresaCodigo = String(formData.get("empresa") ?? "");
  const contacto = String(formData.get("contacto") ?? "").trim();
  const nombreArchivo = String(formData.get("nombreArchivo") ?? "pedido");
  const filasRaw = String(formData.get("filas") ?? "[]");

  const empresaLocal = EMPRESAS.find((e) => e.codigo === empresaCodigo);
  if (!empresaLocal) {
    return { status: "error", mensaje: "Empresa invalida." };
  }

  let filas: FilaAGenerar[];
  try {
    filas = JSON.parse(filasRaw);
  } catch {
    return { status: "error", mensaje: "No se pudieron leer las filas a generar." };
  }
  if (filas.length === 0) {
    return { status: "error", mensaje: "No hay filas validas para generar." };
  }

  // El contacto manual solo hace falta para filas de formato largo (sin
  // centro propio en el archivo); las de formato matriz ya traen su centro.
  if (!contacto && filas.some((f) => !f.centro)) {
    return {
      status: "error",
      mensaje: "Indica el centro de cultivo / contacto antes de generar.",
    };
  }

  const supabase = getSupabaseServiceClient();

  const { data: empresa, error: errEmpresa } = await supabase
    .from("empresas")
    .select(
      "id, relbase_customer_id, dispatch_address, dispatch_city_id, dispatch_commune_id, relbase_ware_house_id"
    )
    .eq("codigo_interno", empresaCodigo)
    .single();

  if (
    errEmpresa ||
    !empresa ||
    empresa.relbase_customer_id == null ||
    empresa.relbase_ware_house_id == null
  ) {
    return {
      status: "error",
      mensaje: "Faltan datos de destino configurados para esta empresa (customer_id / bodega).",
    };
  }

  const { data: cred, error: errCred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", empresa.id)
    .single();

  if (errCred || !cred) {
    return { status: "error", mensaje: "No hay credenciales de Relbase para esta empresa." };
  }

  const credenciales: RelbaseCredenciales = {
    tokenEmpresa: decryptToken(cred.token_empresa),
    tokenUsuarioIntegrador: decryptToken(cred.token_usuario_integrador),
  };

  const { data: corrida, error: errCorrida } = await supabase
    .from("corridas")
    .insert({
      empresa_id: empresa.id,
      usuario: "Hugo Venegas",
      archivo_original_nombre: nombreArchivo,
      total_filas: filas.length,
      total_exitosas: 0,
      total_error: 0,
      estado: "generando",
    })
    .select("id")
    .single();

  if (errCorrida || !corrida) {
    return { status: "error", mensaje: "No se pudo crear el registro de la corrida." };
  }

  const fecha = fechaHoyDDMMYYYY();
  const grupos = agruparPorCentroYCategoria(filas, contacto);
  const resultados: ResultadoGrupo[] = [];
  let totalExitosas = 0;
  let totalError = 0;

  for (const { centro, categoria, filas: filasGrupo } of grupos) {
    const lotes = dividirEnLotes(filasGrupo, MAX_PRODUCTOS_POR_DOCUMENTO);

    for (const lote of lotes) {
      try {
        const respuesta = await crearGuiaDespacho(credenciales, {
          type_document: 52,
          start_date: fecha,
          end_date: fecha,
          customer_id: empresa.relbase_customer_id,
          ware_house_id: empresa.relbase_ware_house_id,
          type_transfer: TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
          address: empresa.dispatch_address ?? "",
          city_id: empresa.dispatch_city_id ?? 0,
          commune_id: empresa.dispatch_commune_id ?? 0,
          contact: centro,
          products: lote.map((f) => ({
            product_id: f.productIdRelbase,
            price: f.precio,
            quantity: f.cantidad,
            tax_affected: true,
            ...(f.descripcionUnidad ? { description: f.descripcionUnidad } : {}),
          })),
        });

        const folio = String(respuesta.folio ?? respuesta.id);

        // El PDF es secundario a la guia ya creada en Relbase: si falla su
        // descarga/guardado, la fila igual queda "generada" con su folio.
        // Relbase genera el PDF de forma asincrona, asi que obtenerPdfUrlDte
        // reintenta unas pocas veces hasta que este listo (ver su doc).
        let pdfPath: string | null = null;
        try {
          const pdfUrl = await obtenerPdfUrlDte(credenciales, respuesta.id);
          if (pdfUrl) {
            pdfPath = await guardarPdfGuia({
              empresaCodigo,
              categoria,
              centro,
              folio,
              pdfUrl,
            });
          }
        } catch {
          pdfPath = null;
        }

        await supabase.from("guias_generadas").insert(
          lote.map((f) => ({
            corrida_id: corrida.id,
            sku: f.codigo,
            product_id_relbase: f.productIdRelbase,
            cantidad: f.cantidad,
            categoria: f.categoria,
            centro,
            folio_relbase: folio,
            estado: "generada",
            fecha_generacion: new Date().toISOString(),
            pdf_path: pdfPath,
          }))
        );

        totalExitosas += lote.length;
        resultados.push({
          centro,
          categoria,
          filas: lote.map((f) => f.fila),
          estado: "generada",
          folio,
          mensajeError: null,
        });
      } catch (err) {
        const mensaje =
          err instanceof RelbaseApiError
            ? `Relbase respondio ${err.status}: ${JSON.stringify(err.body)}`
            : err instanceof Error
              ? err.message
              : "Error desconocido";

        await supabase.from("guias_generadas").insert(
          lote.map((f) => ({
            corrida_id: corrida.id,
            sku: f.codigo,
            product_id_relbase: f.productIdRelbase,
            cantidad: f.cantidad,
            categoria: f.categoria,
            centro,
            estado: "error",
            mensaje_error: mensaje,
          }))
        );

        totalError += lote.length;
        resultados.push({
          centro,
          categoria,
          filas: lote.map((f) => f.fila),
          estado: "error",
          folio: null,
          mensajeError: mensaje,
        });
      }
    }
  }

  await supabase
    .from("corridas")
    .update({
      total_exitosas: totalExitosas,
      total_error: totalError,
      estado: totalError === 0 ? "completada" : "completada_con_errores",
    })
    .eq("id", corrida.id);

  return { status: "ok", corridaId: corrida.id, grupos: resultados };
}
