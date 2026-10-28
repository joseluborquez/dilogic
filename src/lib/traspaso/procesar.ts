import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buscarProductoPorCodigo,
  crearGuiaDespacho,
  listarComprasProveedor,
  obtenerPdfUrlDte,
  RelbaseApiError,
  type CompraRelbase,
} from "@/lib/relbase/client";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";
import {
  COMENTARIO_TIPO_DESPACHO,
  TYPE_DISPATCH_POR_CUENTA_DEL_RECEPTOR,
  TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
} from "@/lib/relbase/types";
import { guardarPdfGuia } from "@/lib/storage/guias-pdf";
import { leerCompraRelbase } from "./compras";
import { leerFacturaProveedor, type FacturaLeida } from "./leer-factura";
import { armarTraspaso, type ResultadoTraspaso } from "./armar";

/** Producto generico de Relbase con el que se traspasan los costos. */
export const CODIGO_PRODUCTO_GENERICO = "O-PG-166053";

export type EstadoFactura = "ok" | "aviso" | "error";

export interface FacturaRevisada {
  /** Nombre del PDF, o "Relbase" si se leyo de los documentos recibidos. */
  archivo: string;
  folio: string;
  proveedorRut: string | null;
  fecha: string | null;
  lineas: number;
  neto: number;
  total: number;
  estado: EstadoFactura;
  mensajes: string[];
  /** Solo para las usables: lo que se emite. */
  leida: FacturaLeida | null;
}

export interface Revision {
  facturas: FacturaRevisada[];
  /** null si ninguna factura se puede usar. */
  calculo: ResultadoTraspaso | null;
}

/** "8.528.429-0" -> "8528429-0", para comparar y guardar siempre igual. */
export function normalizarRut(rut: string): string {
  const limpio = rut.replace(/[^\dkK]/g, "").toUpperCase();
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/**
 * Lee y valida las facturas: cada una debe leerse completa (sus lineas suman
 * el Sub-Total), coincidir con la compra registrada en Relbase y no haber sido
 * traspasada antes. Es la misma revision que se repite al emitir: el
 * contenido de un DTE no se toma de lo que mando el navegador.
 * Las facturas llegan como PDF o como id de una compra recibida en Relbase
 * (de esas solo viaja el id: los productos se vuelven a pedir a Relbase).
 */
export async function revisarFacturas(archivos: File[], compraIds: number[] = []): Promise<Revision> {
  const supabase = getSupabaseServiceClient();
  const revisadas: FacturaRevisada[] = [];
  const comprasPorRut = new Map<string, CompraRelbase[]>();
  const vistos = new Set<string>();

  const fuentes = [
    ...compraIds.map((id) => ({ nombre: "Relbase", desdeRelbase: true, leer: () => leerCompraRelbase(id) })),
    ...archivos.map((archivo) => ({
      nombre: archivo.name,
      desdeRelbase: false,
      leer: async () => leerFacturaProveedor(new Uint8Array(await archivo.arrayBuffer())),
    })),
  ];

  for (const fuente of fuentes) {
    let leida: FacturaLeida;
    try {
      leida = await fuente.leer();
    } catch {
      revisadas.push({
        archivo: fuente.nombre, folio: "", proveedorRut: null, fecha: null, lineas: 0, neto: 0, total: 0,
        estado: "error",
        mensajes: [fuente.desdeRelbase ? "No se pudo leer la factura desde Relbase." : "No se pudo abrir el PDF."],
        leida: null,
      });
      continue;
    }

    const rut = leida.rutEmisor ? normalizarRut(leida.rutEmisor) : null;
    // Sin folio ni lineas no es una factura (ej. una guia guardada en la misma
    // carpeta): un solo mensaje claro en vez de la lista de lo que falto.
    const mensajes =
      !leida.folio && leida.lineas.length === 0
        ? ["No parece una factura de proveedor (¿es una guía u otro documento?)."]
        : [...leida.problemas];
    let estado: EstadoFactura = mensajes.length > 0 ? "error" : "ok";

    if (estado === "ok" && rut) {
      const clave = `${rut}|${leida.folio}`;
      if (vistos.has(clave)) {
        estado = "error";
        mensajes.push("Esta factura viene repetida (en los PDF o también elegida desde Relbase).");
      }
      vistos.add(clave);

      const { data: previo } = await supabase
        .from("traspasos_factura")
        .select("created_at, centro")
        .eq("proveedor_rut", rut)
        .eq("folio", leida.folio)
        .maybeSingle();
      if (previo) {
        estado = "error";
        mensajes.push(
          `Ya se traspasó el ${new Date(previo.created_at).toLocaleDateString("es-CL", { timeZone: "America/Santiago" })} (${previo.centro}).`
        );
      }

      // Leida desde Relbase, ya es la compra registrada: solo el PDF se compara.
      if (!fuente.desdeRelbase) {
        if (!comprasPorRut.has(rut)) {
          try {
            comprasPorRut.set(rut, await listarComprasProveedor(rut));
          } catch {
            comprasPorRut.set(rut, []);
          }
        }
        const compra = comprasPorRut.get(rut)!.find((c) => String(c.folio) === leida.folio);
        if (!compra) {
          if (estado === "ok") estado = "aviso";
          mensajes.push("No aparece como compra en Relbase: no se pudo comparar con el registro del SII.");
        } else if (compra.neto !== leida.neto || compra.total !== leida.total) {
          estado = "error";
          mensajes.push(
            `No calza con la compra registrada en Relbase (neto $${compra.neto.toLocaleString("es-CL")}, total $${compra.total.toLocaleString("es-CL")}).`
          );
        }
      }
    } else if (estado === "ok") {
      estado = "error";
      mensajes.push("No se encontró el RUT del proveedor.");
    }

    revisadas.push({
      archivo: fuente.nombre,
      folio: leida.folio,
      proveedorRut: rut,
      fecha: leida.fecha,
      lineas: leida.lineas.length,
      neto: leida.neto,
      total: leida.total,
      estado,
      mensajes,
      leida: estado === "error" ? null : leida,
    });
  }

  const usables = revisadas.flatMap((r) => (r.leida ? [r.leida] : []));
  return { facturas: revisadas, calculo: usables.length > 0 ? armarTraspaso(usables) : null };
}

export interface GuiaEmitida {
  folio: string | null;
  lineas: number;
  total: number;
  error: string | null;
}

export type ResultadoEmision =
  | { ok: false; mensaje: string; revision?: Revision }
  | { ok: true; corridaId: string; guias: GuiaEmitida[]; yaExistia: boolean };

function fechaHoyChile(): string {
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
 * Emite las guias del traspaso. Antes de emitir reserva las facturas en
 * traspasos_factura (rut + folio unicos): si otra pestana o un doble clic
 * llega a la vez, la segunda choca con la restriccion y no emite nada.
 */
export async function emitirTraspaso(params: {
  archivos: File[];
  compraIds: number[];
  empresaCodigo: string;
  centro: string;
  idempotencyKey: string;
  usuario: { id: string; nombre: string | null; email: string };
}): Promise<ResultadoEmision> {
  const { archivos, compraIds, empresaCodigo, idempotencyKey, usuario } = params;
  const centro = params.centro.trim().toUpperCase();
  if (!centro) return { ok: false, mensaje: "Indica el centro / contacto de las guías." };

  const supabase = getSupabaseServiceClient();

  // Reenvio de un traspaso ya emitido: se devuelve lo que quedo.
  const { data: previa } = await supabase
    .from("corridas")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (previa) {
    const { data: filas } = await supabase
      .from("guias_generadas")
      .select("folio_relbase")
      .eq("corrida_id", previa.id)
      .is("eliminado_en", null);
    const folios = [...new Set((filas ?? []).map((f) => f.folio_relbase))];
    return {
      ok: true,
      corridaId: previa.id,
      yaExistia: true,
      guias: folios.map((folio) => ({ folio, lineas: 0, total: 0, error: null })),
    };
  }

  const revision = await revisarFacturas(archivos, compraIds);
  if (revision.facturas.some((f) => f.estado === "error")) {
    return { ok: false, mensaje: "Hay facturas con errores: quítalas o corrígelas antes de emitir.", revision };
  }
  if (!revision.calculo) return { ok: false, mensaje: "No hay facturas para traspasar.", revision };

  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, relbase_customer_id, dispatch_address, dispatch_city_id, dispatch_commune_id, relbase_ware_house_id")
    .eq("codigo_interno", empresaCodigo)
    .single();
  if (!empresa?.relbase_customer_id || !empresa.relbase_ware_house_id) {
    return { ok: false, mensaje: "Faltan datos de destino de la empresa (cliente / bodega en Relbase)." };
  }

  if ((await obtenerEstadoConexion()).estado !== "conectada") {
    return { ok: false, mensaje: "Relbase no está conectado. Un administrador debe conectarlo en Empresas." };
  }

  const generico = await buscarProductoPorCodigo(CODIGO_PRODUCTO_GENERICO);
  if (!generico) return { ok: false, mensaje: `No existe el producto ${CODIGO_PRODUCTO_GENERICO} en Relbase.` };

  const usables = revision.facturas.filter((f) => f.leida);
  const { data: corrida, error: errCorrida } = await supabase
    .from("corridas")
    .insert({
      empresa_id: empresa.id,
      usuario: usuario.nombre ?? usuario.email,
      usuario_id: usuario.id,
      archivo_original_nombre: `Traspaso de costos: ${usables.length} factura(s) ${usables[0].proveedorRut}`,
      total_filas: revision.calculo.guias.reduce((n, g) => n + g.lineas.length, 0),
      total_exitosas: 0,
      total_error: 0,
      estado: "generando",
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();
  if (errCorrida || !corrida) return { ok: false, mensaje: "No se pudo registrar el traspaso." };

  // Reserva de las facturas, antes de emitir nada.
  const { error: errReserva } = await supabase.from("traspasos_factura").insert(
    usables.map((f) => ({
      proveedor_rut: f.proveedorRut!,
      folio: f.folio,
      fecha_factura: f.fecha,
      neto: f.neto,
      total: f.total,
      empresa_id: empresa.id,
      centro,
      corrida_id: corrida.id,
    }))
  );
  if (errReserva) {
    await supabase.from("corridas").delete().eq("id", corrida.id);
    return { ok: false, mensaje: "Alguna de estas facturas acaba de traspasarse en otra pestaña. Revisa el historial." };
  }

  const fecha = fechaHoyChile();
  const resultado: GuiaEmitida[] = [];
  let exitosas = 0;
  let conError = 0;

  for (const [indice, guia] of revision.calculo.guias.entries()) {
    try {
      const respuesta = await crearGuiaDespacho(
        {
          type_document: 52,
          start_date: fecha,
          end_date: fecha,
          customer_id: empresa.relbase_customer_id,
          ware_house_id: empresa.relbase_ware_house_id,
          type_transfer: TYPE_TRANSFER_OTROS_TRASLADOS_NO_VENTA,
          type_dispatch: TYPE_DISPATCH_POR_CUENTA_DEL_RECEPTOR,
          comment: COMENTARIO_TIPO_DESPACHO,
          address: empresa.dispatch_address ?? "",
          city_id: empresa.dispatch_city_id ?? 0,
          commune_id: empresa.dispatch_commune_id ?? 0,
          contact: centro,
          products: guia.lineas.map((l) => ({
            product_id: generico.id,
            price: l.precio,
            quantity: l.cantidad,
            tax_affected: true,
            description: l.descripcion,
          })),
        },
        `dilogic-traspaso-${corrida.id}-${indice}`
      );
      const folio = String(respuesta.folio ?? respuesta.id);
      let pdfPath: string | null = null;
      try {
        const url = await obtenerPdfUrlDte(respuesta.id);
        if (url) pdfPath = await guardarPdfGuia({ empresaCodigo, categoria: "GENERICO", centro, folio, pdfUrl: url });
      } catch {
        pdfPath = null;
      }
      await supabase.from("guias_generadas").insert(
        guia.lineas.map((l) => ({
          corrida_id: corrida.id,
          sku: CODIGO_PRODUCTO_GENERICO,
          product_id_relbase: generico.id,
          cantidad: l.cantidad,
          categoria: "GENERICO",
          centro,
          folio_relbase: folio,
          dte_id_relbase: respuesta.id,
          estado: "generada",
          fecha_generacion: new Date().toISOString(),
          pdf_path: pdfPath,
        }))
      );
      exitosas += guia.lineas.length;
      resultado.push({ folio, lineas: guia.lineas.length, total: guia.total, error: null });
    } catch (err) {
      const mensaje =
        err instanceof RelbaseApiError
          ? `Relbase respondió ${err.status}: ${JSON.stringify(err.body)}`
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      await supabase.from("guias_generadas").insert(
        guia.lineas.map((l) => ({
          corrida_id: corrida.id,
          sku: CODIGO_PRODUCTO_GENERICO,
          product_id_relbase: generico.id,
          cantidad: l.cantidad,
          categoria: "GENERICO",
          centro,
          estado: "error",
          mensaje_error: mensaje,
        }))
      );
      conError += guia.lineas.length;
      resultado.push({ folio: null, lineas: guia.lineas.length, total: guia.total, error: mensaje });
    }
  }

  await supabase
    .from("corridas")
    .update({
      total_exitosas: exitosas,
      total_error: conError,
      estado: conError === 0 ? "completada" : exitosas === 0 ? "error" : "completada_con_errores",
    })
    .eq("id", corrida.id);

  // Si no salio ninguna guia, las facturas quedan libres para reintentar.
  if (exitosas === 0) await supabase.from("traspasos_factura").delete().eq("corrida_id", corrida.id);

  return { ok: true, corridaId: corrida.id, guias: resultado, yaExistia: false };
}
