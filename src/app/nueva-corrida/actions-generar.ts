"use server";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto/tokens";
import { crearGuiaDespacho, RelbaseApiError } from "@/lib/relbase/client";
import {
  TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
  type RelbaseCredenciales,
} from "@/lib/relbase/types";
import { EMPRESAS } from "./empresas";

interface FilaAGenerar {
  fila: number;
  codigo: string;
  cantidad: number;
  categoria: string | null;
  productIdRelbase: number;
  precio: number;
}

export interface ResultadoGrupo {
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

function agruparPorCategoria(filas: FilaAGenerar[]): Map<string | null, FilaAGenerar[]> {
  const grupos = new Map<string | null, FilaAGenerar[]>();
  for (const fila of filas) {
    const clave = fila.categoria;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(fila);
  }
  return grupos;
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
  if (!contacto) {
    return {
      status: "error",
      mensaje: "Indica el centro de cultivo / contacto antes de generar.",
    };
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
  const grupos = agruparPorCategoria(filas);
  const resultados: ResultadoGrupo[] = [];
  let totalExitosas = 0;
  let totalError = 0;

  for (const [categoria, filasGrupo] of grupos) {
    try {
      const respuesta = await crearGuiaDespacho(credenciales, {
        type_document: 52,
        start_date: fecha,
        end_date: fecha,
        customer_id: empresa.relbase_customer_id,
        ware_house_id: empresa.relbase_ware_house_id,
        type_transfer: TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
        dispatch_address: empresa.dispatch_address ?? "",
        dispatch_city_id: empresa.dispatch_city_id ?? 0,
        dispatch_commune_id: empresa.dispatch_commune_id ?? 0,
        contact: contacto,
        products: filasGrupo.map((f) => ({
          product_id: f.productIdRelbase,
          price: f.precio,
          quantity: f.cantidad,
          tax_affected: true,
        })),
      });

      const folio = String(respuesta.folio ?? respuesta.id);

      await supabase.from("guias_generadas").insert(
        filasGrupo.map((f) => ({
          corrida_id: corrida.id,
          sku: f.codigo,
          product_id_relbase: f.productIdRelbase,
          cantidad: f.cantidad,
          categoria: f.categoria,
          folio_relbase: folio,
          estado: "generada",
          fecha_generacion: new Date().toISOString(),
        }))
      );

      totalExitosas += filasGrupo.length;
      resultados.push({
        categoria,
        filas: filasGrupo.map((f) => f.fila),
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
        filasGrupo.map((f) => ({
          corrida_id: corrida.id,
          sku: f.codigo,
          product_id_relbase: f.productIdRelbase,
          cantidad: f.cantidad,
          categoria: f.categoria,
          estado: "error",
          mensaje_error: mensaje,
        }))
      );

      totalError += filasGrupo.length;
      resultados.push({
        categoria,
        filas: filasGrupo.map((f) => f.fila),
        estado: "error",
        folio: null,
        mensajeError: mensaje,
      });
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
