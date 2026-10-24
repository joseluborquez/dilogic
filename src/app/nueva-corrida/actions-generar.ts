"use server";

import { createHash } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { crearGuiaDespacho, obtenerPdfUrlDte, RelbaseApiError } from "@/lib/relbase/client";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";
import {
  COMENTARIO_TIPO_DESPACHO,
  TYPE_DISPATCH_POR_CUENTA_DEL_RECEPTOR,
  TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
} from "@/lib/relbase/types";
import { guardarPdfGuia } from "@/lib/storage/guias-pdf";
import { obtenerCatalogoEmpresa } from "@/lib/catalogo/validar";
import { armarGuias } from "@/lib/guias/armar";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { requerirUsuario } from "@/lib/auth/sesion";

/**
 * Lo que manda el navegador. Solo se le cree el pedido en si (que codigo, cuanta
 * cantidad, para que centro): el producto de Relbase, su precio y su categoria
 * los vuelve a resolver el servidor contra el catalogo, porque de ahi sale el
 * contenido del DTE.
 */
interface FilaPedida {
  fila: number;
  codigo: string;
  cantidad: number;
  centro: string | null;
}

/** Fila ya resuelta contra el catalogo, lista para el payload de Relbase. */
interface FilaAGenerar extends FilaPedida {
  categoria: string | null;
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
      /** El pedido ya se habia generado antes: esto es lo que quedo, no algo nuevo. */
      yaExistia?: boolean;
    };

/**
 * Revalida el pedido contra el catalogo de la empresa. Las guias son DTEs del
 * SII: su contenido no puede depender de un JSON que viajo al navegador y
 * volvio, ni de una validacion hecha minutos antes (el catalogo pudo
 * resincronizarse entremedio).
 */
async function resolverContraCatalogo(
  empresaCodigo: string,
  pedidas: FilaPedida[]
): Promise<{ ok: true; filas: FilaAGenerar[] } | { ok: false; mensaje: string }> {
  const { mapa: catalogo } = await obtenerCatalogoEmpresa(empresaCodigo);
  const filas: FilaAGenerar[] = [];
  const problemas: string[] = [];

  for (const pedida of pedidas) {
    const codigo = String(pedida.codigo ?? "").trim();
    const cantidad = Number(pedida.cantidad);

    if (!codigo) {
      problemas.push(`fila ${pedida.fila}: sin código`);
      continue;
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      problemas.push(`${codigo}: cantidad inválida`);
      continue;
    }

    const producto = catalogo.get(codigo);
    if (!producto) {
      problemas.push(`${codigo}: ya no está en el catálogo`);
      continue;
    }
    if (!producto.activo) {
      problemas.push(`${codigo}: está desactivado en el catálogo`);
      continue;
    }
    if (producto.productIdRelbase == null) {
      problemas.push(`${codigo}: sin producto de Relbase (falta sincronizar)`);
      continue;
    }
    if (producto.precio == null) {
      problemas.push(`${codigo}: sin precio en el catálogo`);
      continue;
    }

    filas.push({
      fila: pedida.fila,
      codigo,
      cantidad,
      centro: pedida.centro ?? null,
      categoria: producto.familia,
      productIdRelbase: producto.productIdRelbase,
      precio: producto.precio,
      descripcionUnidad: producto.descripcionUnidad,
    });
  }

  if (problemas.length > 0) {
    return {
      ok: false,
      mensaje: `El pedido cambió respecto a la validación y no se generó ninguna guía. Vuelve a validarlo. Detalle: ${problemas
        .slice(0, 5)
        .join("; ")}${problemas.length > 5 ? ` y ${problemas.length - 5} más` : ""}.`,
    };
  }

  return { ok: true, filas };
}

/**
 * Fecha de hoy en Chile. Con getDate() se usaba la zona del servidor, que en
 * Vercel es UTC: desde las 21:00 (20:00 en invierno) las guias salian con la
 * fecha de manana.
 */
function fechaHoyDDMMYYYY(): string {
  const partes = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("day")}-${valor("month")}-${valor("year")}`;
}

/**
 * Idempotency-Key de una guia: la misma corrida, centro, categoria y lote dan
 * siempre la misma clave (Relbase la aisla por empresa, usuario y app).
 */
function claveIdempotenciaGuia(
  corridaId: string,
  centro: string,
  categoria: string | null,
  lote: number
): string {
  const huella = createHash("sha256")
    .update(`${corridaId}|${centro}|${categoria ?? ""}|${lote}`)
    .digest("hex");
  return `dilogic-guia-${huella.slice(0, 40)}`;
}

// Pasado este tiempo de corrida, se deja de esperar a que Relbase timbre el
// PDF (se hace un solo intento sin esperas). Crear las guias es la tarea
// principal y no puede quedarse sin tiempo de ejecucion por culpa de la
// secundaria: el PDF se puede recuperar despues con dte_id_relbase, una guia
// a medio generar no.
const PRESUPUESTO_ESPERA_PDF_MS = 180_000;

/**
 * Reconstruye el resultado de una corrida ya generada, para responder a un
 * reenvio con lo que realmente quedo emitido.
 */
async function recuperarCorridaExistente(
  idempotencyKey: string
): Promise<EstadoGeneracion | null> {
  const supabase = getSupabaseServiceClient();

  const { data: corrida } = await supabase
    .from("corridas")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (!corrida) return null;

  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("guias_generadas")
      .select("centro, categoria, folio_relbase, estado, mensaje_error")
      .eq("corrida_id", corrida.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const porGuia = new Map<string, ResultadoGrupo>();
  for (const fila of filas) {
    const clave =
      fila.estado === "generada"
        ? `g:${fila.folio_relbase}`
        : `e:${fila.centro ?? ""}:${fila.categoria ?? ""}:${fila.mensaje_error ?? ""}`;
    if (!porGuia.has(clave)) {
      porGuia.set(clave, {
        centro: fila.centro ?? "",
        categoria: fila.categoria,
        filas: [],
        estado: fila.estado === "generada" ? "generada" : "error",
        folio: fila.folio_relbase,
        mensajeError: fila.mensaje_error,
      });
    }
  }

  return { status: "ok", corridaId: corrida.id, grupos: [...porGuia.values()], yaExistia: true };
}

export async function generarGuiasAction(
  _prevState: EstadoGeneracion,
  formData: FormData
): Promise<EstadoGeneracion> {
  // Una server action es un endpoint publico: la sesion se verifica aca, no
  // basta con que la pagina que muestra el boton este protegida.
  const usuario = await requerirUsuario();

  const empresaCodigo = String(formData.get("empresa") ?? "");
  const contacto = String(formData.get("contacto") ?? "").trim();
  // Agrupar: juntar categorias de un mismo centro en la menor cantidad de
  // guias (ver lib/guias/armar.ts). Sin la opcion, una guia por categoria.
  const agrupar = formData.get("agrupar") === "1";
  const nombreArchivo = String(formData.get("nombreArchivo") ?? "pedido");
  const filasRaw = String(formData.get("filas") ?? "[]");

  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  // La empresa se valida contra la base mas abajo, al buscar sus datos de
  // destino: no hay lista de empresas en el codigo.
  let pedidas: FilaPedida[];
  try {
    pedidas = JSON.parse(filasRaw);
  } catch {
    return { status: "error", mensaje: "No se pudieron leer las filas a generar." };
  }
  if (!Array.isArray(pedidas) || pedidas.length === 0) {
    return { status: "error", mensaje: "No hay filas validas para generar." };
  }

  // El contacto manual solo hace falta para filas de formato largo (sin
  // centro propio en el archivo); las de formato matriz ya traen su centro.
  if (!contacto && pedidas.some((f) => !f.centro)) {
    return {
      status: "error",
      mensaje: "Indica el centro de cultivo / contacto antes de generar.",
    };
  }

  // Antes de crear la corrida: sin conexion cada guia fallaria por separado y
  // dejaria filas en error en el historial por algo que no es culpa del pedido.
  const conexion = await obtenerEstadoConexion();
  if (conexion.estado !== "conectada") {
    return {
      status: "error",
      mensaje:
        conexion.estado === "revocada"
          ? "Relbase cerró la conexión. Un administrador debe reconectarla en Empresas antes de generar."
          : "Relbase no está conectado. Un administrador debe conectarlo en Empresas antes de generar.",
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

  // Ya confirmada la empresa, se resuelve el pedido contra su catalogo.
  const resuelto = await resolverContraCatalogo(empresaCodigo, pedidas);
  if (!resuelto.ok) {
    return { status: "error", mensaje: resuelto.mensaje };
  }
  const filas = resuelto.filas;

  const { data: corrida, error: errCorrida } = await supabase
    .from("corridas")
    .insert({
      empresa_id: empresa.id,
      usuario: usuario.nombre ?? usuario.email,
      usuario_id: usuario.id,
      archivo_original_nombre: nombreArchivo,
      total_filas: filas.length,
      total_exitosas: 0,
      total_error: 0,
      estado: "generando",
      idempotency_key: idempotencyKey || null,
    })
    .select("id")
    .single();

  if (errCorrida || !corrida) {
    // 23505 = choque con idx_corridas_idempotency: este pedido ya se genero.
    // Se devuelve lo que quedo la primera vez en vez de emitir un segundo
    // juego de DTEs, que no habria forma de deshacer.
    if (errCorrida?.code === "23505" && idempotencyKey) {
      const anterior = await recuperarCorridaExistente(idempotencyKey);
      if (anterior) return anterior;
    }
    return { status: "error", mensaje: "No se pudo crear el registro de la corrida." };
  }

  const fecha = fechaHoyDDMMYYYY();
  const inicioCorrida = Date.now();
  // En archivos formato matriz el centro viene del propio archivo (columna);
  // en formato largo viene del campo "contacto" ingresado a mano.
  const guias = armarGuias(filas, contacto, agrupar);
  // Ya validados arriba. Se copian a constantes porque TypeScript no conserva
  // el estrechamiento de propiedades dentro de la funcion anidada de abajo.
  const destino = {
    corridaId: corrida.id,
    customerId: empresa.relbase_customer_id,
    wareHouseId: empresa.relbase_ware_house_id,
    address: empresa.dispatch_address ?? "",
    cityId: empresa.dispatch_city_id ?? 0,
    communeId: empresa.dispatch_commune_id ?? 0,
  };
  const resultados: ResultadoGrupo[] = [];
  let totalExitosas = 0;
  let totalError = 0;

  // Un fallo fuera del try por guia (la base, por ejemplo) dejaba la corrida
  // en "generando" para siempre, sin nada que la reconciliara. Se marca antes
  // de devolver el error.
  try {
    await generarCadaGuia();
  } catch (err) {
    await supabase
      .from("corridas")
      .update({ total_exitosas: totalExitosas, total_error: totalError, estado: "error" })
      .eq("id", corrida.id);

    return {
      status: "error",
      mensaje: `La generacion se interrumpio tras ${totalExitosas} guia(s). Revisa el historial antes de reintentar: las que alcanzaron a emitirse ya existen en Relbase. Detalle: ${
        err instanceof Error ? err.message : "error desconocido"
      }`,
    };
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

  async function generarCadaGuia() {
    for (const [indiceGuia, { centro, categoria, filas: lote }] of guias.entries()) {
      try {
        const respuesta = await crearGuiaDespacho(
          {
            type_document: 52,
            start_date: fecha,
            end_date: fecha,
            customer_id: destino.customerId,
            ware_house_id: destino.wareHouseId,
            type_transfer: TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
            type_dispatch: TYPE_DISPATCH_POR_CUENTA_DEL_RECEPTOR,
            comment: COMENTARIO_TIPO_DESPACHO,
            address: destino.address,
            city_id: destino.cityId,
            commune_id: destino.communeId,
            contact: centro,
            products: lote.map((f) => ({
              product_id: f.productIdRelbase,
              price: f.precio,
              quantity: f.cantidad,
              tax_affected: true,
              ...(f.descripcionUnidad ? { description: f.descripcionUnidad } : {}),
            })),
          },
          claveIdempotenciaGuia(destino.corridaId, centro, categoria, indiceGuia)
        );

        const folio = String(respuesta.folio ?? respuesta.id);

        // El PDF es secundario a la guia ya creada en Relbase: si falla su
        // descarga/guardado, la fila igual queda "generada" con su folio.
        // Relbase genera el PDF de forma asincrona, asi que obtenerPdfUrlDte
        // reintenta unas pocas veces hasta que este listo (ver su doc).
        let pdfPath: string | null = null;
        try {
          const quedaTiempo = Date.now() - inicioCorrida < PRESUPUESTO_ESPERA_PDF_MS;
          const pdfUrl = await obtenerPdfUrlDte(
            respuesta.id,
            quedaTiempo ? {} : { intentos: 1 }
          );
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
            corrida_id: destino.corridaId,
            sku: f.codigo,
            product_id_relbase: f.productIdRelbase,
            cantidad: f.cantidad,
            categoria,
            centro,
            folio_relbase: folio,
            // Se guarda aunque el PDF si se haya capturado: es lo que permite
            // volver a pedirlo a Relbase mas adelante.
            dte_id_relbase: respuesta.id,
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
            corrida_id: destino.corridaId,
            sku: f.codigo,
            product_id_relbase: f.productIdRelbase,
            cantidad: f.cantidad,
            categoria,
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
}
