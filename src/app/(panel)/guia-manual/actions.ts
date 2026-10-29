"use server";

import { createHash } from "node:crypto";
import { requerirUsuario } from "@/lib/auth/sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buscarCiudadesRelbase,
  buscarClientesRelbase,
  buscarComunasRelbase,
  buscarProductos,
  crearGuiaDespacho,
  listarDireccionesCliente,
  listarFormasPago,
  obtenerCliente,
  obtenerPdfUrlDte,
  obtenerProducto,
  obtenerTiposTraslado,
  RelbaseApiError,
} from "@/lib/relbase/client";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";
import { TIPOS_DESPACHO, type RelbaseCrearDtePayload, type RelbaseReferencia } from "@/lib/relbase/types";
import { obtenerValoresPorDefecto } from "@/lib/empresas/consultar";
import { productosParaGuia } from "@/lib/guia-manual/datos";
import { PRODUCTO_GENERICO, OPCIONES_PRECIO, type OpcionPrecio, type ProductoGuia } from "@/lib/guia-manual/resolver";
import { fechaHoyDDMMYYYY } from "@/lib/util/fechas";
import { recordar } from "@/lib/guia-manual/memoria";
import { MAX_PRODUCTOS_POR_GUIA } from "@/lib/guias/armar";

// ---------------------------------------------------------------------------
// Lecturas (solo GET a Relbase)
// ---------------------------------------------------------------------------

export interface ClienteEncontrado {
  id: number;
  rut: string;
  nombre: string;
  direccion: string;
}

export async function buscarClientesAction(texto: string): Promise<ClienteEncontrado[]> {
  await requerirUsuario();
  const q = texto.trim();
  if (q.length < 2) return [];
  const lista = await buscarClientesRelbase(q);
  return lista.slice(0, 20).map((c) => ({
    id: c.id,
    rut: String(c.rut ?? ""),
    nombre: String(c.name ?? ""),
    direccion: String(c.address ?? ""),
  }));
}

export interface LugarCliente {
  /** null = la direccion principal del cliente. */
  id: number | null;
  direccion: string;
  ciudadId: number | null;
  ciudad: string | null;
  comunaId: number | null;
  comuna: string | null;
}

export interface ClienteCompleto {
  id: number;
  rut: string;
  nombre: string;
  fantasia: string | null;
  formaPagoId: number | null;
  principal: LugarCliente;
  /** Direcciones de despacho adicionales (puede no haber). */
  despacho: LugarCliente[];
}

async function nombresDeLugar(ciudadId: number | null, comunaId: number | null) {
  if (!ciudadId) return { ciudad: null, comuna: null };
  const [ciudades, comunas] = await Promise.all([
    buscarCiudadesRelbase(""),
    comunaId ? buscarComunasRelbase(ciudadId, "") : Promise.resolve([]),
  ]);
  const nombre = (r: RelbaseReferencia | undefined) => (typeof r?.name === "string" ? r.name : null);
  return {
    ciudad: nombre(ciudades.find((c) => c.id === ciudadId)),
    comuna: nombre(comunas.find((c) => c.id === comunaId)),
  };
}

export async function cargarClienteAction(
  id: number
): Promise<{ ok: true; cliente: ClienteCompleto } | { ok: false; mensaje: string }> {
  await requerirUsuario();
  const [cliente, direcciones] = await Promise.all([obtenerCliente(id), listarDireccionesCliente(id)]);
  if (!cliente) return { ok: false, mensaje: "Relbase no encontró ese cliente." };

  const lugar = async (lid: number | null, direccion: string | null, ciudadId: number | null, comunaId: number | null) => ({
    id: lid,
    direccion: direccion ?? "",
    ciudadId,
    comunaId,
    ...(await nombresDeLugar(ciudadId, comunaId)),
  });

  return {
    ok: true,
    cliente: {
      id: cliente.id,
      rut: cliente.rut,
      nombre: cliente.name,
      fantasia: cliente.name_fantasy,
      formaPagoId: cliente.type_payment_id,
      principal: await lugar(null, cliente.address, cliente.city_id, cliente.commune_id),
      despacho: await Promise.all(direcciones.map((d) => lugar(d.id, d.address, d.city_id, d.commune_id))),
    },
  };
}

/** Productos de Relbase fuera del catalogo de la app (otros formatos de codigo). */
export async function buscarOtrosProductosAction(texto: string): Promise<ProductoGuia[]> {
  await requerirUsuario();
  const q = texto.trim();
  if (q.length < 2) return [];
  const lista = await buscarProductos(q);
  return lista
    .filter((p) => p.code && p.enabled !== false && !/^(CERQ|MTX|YDR)_[A-Z]+_\d+$/.test(p.code))
    .slice(0, 20)
    .map((p) => {
      const precio = Number(p.price);
      return {
        productId: p.id,
        codigo: p.code!,
        nombre: p.name,
        empresa: null,
        familia: null,
        precio: Number.isFinite(precio) && precio > 1 ? Math.round(precio) : null,
        origenPrecio: Number.isFinite(precio) && precio > 1 ? ("catalogo" as const) : null,
      };
    });
}

const MAX_CODIGOS_LISTADO = 40;

/**
 * Productos de Relbase por codigo exacto, para los codigos del listado que no
 * estan en el catalogo de Cermaq, Multiexport y Yadran (los creados para un
 * cliente esporadico, como A-AD-124343). Precio: el ultimo cobrado en una
 * guia valida; si nunca se vendio, el de Relbase. Solo lecturas.
 */
export async function productosPorCodigoAction(codigos: string[]): Promise<ProductoGuia[]> {
  await requerirUsuario();
  const pedidos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_CODIGOS_LISTADO);
  if (pedidos.length === 0) return [];

  const encontrados = (
    await Promise.all(
      pedidos.map(async (codigo) => {
        const lista = await buscarProductos(codigo).catch(() => []);
        return lista.find((p) => p.code?.toUpperCase() === codigo && p.enabled !== false) ?? null;
      })
    )
  ).filter((p): p is NonNullable<typeof p> => p != null);
  if (encontrados.length === 0) return [];

  const { data: ventas } = await getSupabaseServiceClient()
    .from("ventas_lineas")
    .select("codigo, precio, ventas_guias!inner(fecha, anulada)")
    .in("codigo", encontrados.map((p) => p.code!))
    .eq("ventas_guias.anulada", false);
  const ultimo = new Map<string, { fecha: string; precio: number }>();
  for (const v of (ventas ?? []) as unknown as { codigo: string; precio: number; ventas_guias: { fecha: string } }[]) {
    const precio = Math.round(Number(v.precio));
    const actual = ultimo.get(v.codigo);
    if (precio > 1 && (!actual || v.ventas_guias.fecha > actual.fecha)) ultimo.set(v.codigo, { fecha: v.ventas_guias.fecha, precio });
  }

  return encontrados.map((p) => {
    const vendido = ultimo.get(p.code!)?.precio ?? null;
    const relbase = Number(p.price);
    const catalogo = Number.isFinite(relbase) && relbase > 1 ? Math.round(relbase) : null;
    return {
      productId: p.id,
      codigo: p.code!,
      nombre: p.name,
      empresa: null,
      familia: null,
      precio: vendido ?? catalogo,
      origenPrecio: vendido != null ? ("ventas" as const) : catalogo != null ? ("catalogo" as const) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Emision
// ---------------------------------------------------------------------------

export interface LineaPedida {
  productId: number;
  codigo: string;
  /** Obligatoria en el PRODUCTO GENERICO. */
  descripcion: string | null;
  cantidad: number;
  precio: number;
}

/** null en un dato de transporte = "no se cuenta con este dato". */
export interface Transporte {
  patente: string | null;
  rutTransportista: string | null;
  rutChofer: string | null;
  nombreChofer: string | null;
}

export interface GuiaPedida {
  idempotencyKey: string;
  clienteId: number;
  /** null = despachar a la direccion principal. */
  direccionDespachoId: number | null;
  formaPagoId: number | null;
  opcion: OpcionPrecio;
  tipoTraslado: number;
  tipoDespacho: number;
  contacto: string;
  comentario: string;
  transporte: Transporte;
  lineas: LineaPedida[];
  /** Lineas que vinieron del listado del cliente: se guardan en la memoria al emitir. */
  aprender?: { texto: string; codigo: string; productId: number | null }[];
}

export type ResultadoEmision =
  | { status: "ok"; folio: string; dteId: number; neto: number; pdfUrl: string | null; yaEmitida?: boolean }
  | { status: "error"; mensaje: string; nuevaLlave: boolean };

/** RUT chileno con digito verificador valido (modulo 11). */
function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[.\s-]/g, "").toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === limpio.slice(-1);
}

const formatoRut = (rut: string) => {
  const l = rut.replace(/[.\s-]/g, "").toUpperCase();
  return `${l.slice(0, -1)}-${l.slice(-1)}`;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LLAVE_GUIA = new RegExp(`^${UUID}(-\\d{1,3}-${UUID})?$`, "i");

/** Relbase recibe un UUID estable derivado de la llave de la guía (la llave completa mide ~75 caracteres). */
const uuidDeLlave = (llave: string) => {
  const h = createHash("sha256").update(llave).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const errorDeRelbase = (err: RelbaseApiError) => {
  const body = err.body as { error?: unknown; message?: unknown; meta?: { message?: unknown } } | undefined;
  const detalle = body?.error ?? body?.message ?? body?.meta?.message;
  return typeof detalle === "string" ? detalle : JSON.stringify(detalle ?? body ?? "").slice(0, 300);
};

export async function emitirGuiaManualAction(pedida: GuiaPedida): Promise<ResultadoEmision> {
  const usuario = await requerirUsuario();
  const fallo = (mensaje: string, nuevaLlave = false): ResultadoEmision => ({ status: "error", mensaje, nuevaLlave });

  // --- Validaciones que no dependen de Relbase ---------------------------
  // Llave por guía: «<uuid del pedido>-<n° de guía>-<uuid de su primera línea>» (GuiaManualForm).
  if (!LLAVE_GUIA.test(pedida.idempotencyKey ?? "")) return fallo("Falta la llave de emisión. Recarga la página.", true);
  if (!OPCIONES_PRECIO.some((o) => o.valor === pedida.opcion)) return fallo("Opción de precio inválida.");
  if (![1, 2, 3].includes(pedida.tipoDespacho)) return fallo("Elige el tipo de despacho: es obligatorio ante el SII.");
  if (!Array.isArray(pedida.lineas) || pedida.lineas.length === 0) return fallo("La guía no tiene productos.");
  if (pedida.lineas.length > MAX_PRODUCTOS_POR_GUIA) {
    return fallo(`Relbase acepta hasta ${MAX_PRODUCTOS_POR_GUIA} productos por guía; esta tiene ${pedida.lineas.length}.`);
  }
  const t = pedida.transporte;
  for (const [valor, nombre] of [
    [t.patente, "la patente"],
    [t.rutTransportista, "el RUT del transportista"],
    [t.rutChofer, "el RUT del chofer"],
    [t.nombreChofer, "el nombre del chofer"],
  ] as const) {
    if (valor !== null && !valor.trim()) return fallo(`Escribe ${nombre} o marca que no se cuenta con ese dato.`);
  }
  for (const [rut, nombre] of [
    [t.rutTransportista, "del transportista"],
    [t.rutChofer, "del chofer"],
  ] as const) {
    if (rut && !rutValido(rut)) return fallo(`El RUT ${nombre} no es válido (revisa el dígito verificador).`);
  }
  if (t.patente && !/^[A-Z0-9]{4,8}$/i.test(t.patente.replace(/[\s.-]/g, ""))) return fallo("La patente no parece válida.");

  // --- Lo que se revisa contra Relbase y el catalogo -----------------------
  const conexion = await obtenerEstadoConexion();
  if (conexion.estado !== "conectada") return fallo("Relbase no está conectado. Un administrador debe conectarlo en Empresas.");
  if (conexion.scopesFaltantes.includes("documents:write")) {
    return fallo("La conexión con Relbase no tiene permiso para emitir (documents:write). Hay que reautorizar en Empresas.");
  }

  const [cliente, direcciones, tipos, formas, valores, catalogo] = await Promise.all([
    obtenerCliente(pedida.clienteId),
    pedida.direccionDespachoId ? listarDireccionesCliente(pedida.clienteId) : Promise.resolve([]),
    obtenerTiposTraslado(),
    listarFormasPago(),
    obtenerValoresPorDefecto(),
    productosParaGuia(),
  ]);
  if (!cliente) return fallo("Relbase no encontró el cliente.");
  if (!cliente.address || !cliente.city_id || !cliente.commune_id) {
    return fallo("El cliente no tiene dirección, ciudad y comuna en Relbase; complétalas allá antes de emitir.");
  }
  if (!tipos.some((x) => x.id === pedida.tipoTraslado)) return fallo("Tipo de traslado inválido.");
  if (pedida.formaPagoId != null && !formas.some((f) => f.id === pedida.formaPagoId)) return fallo("Forma de pago inválida.");
  if (valores.wareHouseId == null) return fallo("No hay bodega de salida configurada (Empresas).");
  const despacho = pedida.direccionDespachoId ? direcciones.find((d) => d.id === pedida.direccionDespachoId) : null;
  if (pedida.direccionDespachoId && !despacho) return fallo("Esa dirección de despacho ya no está en Relbase.");

  const enCatalogo = new Map(catalogo.map((p) => [p.productId, p]));
  const productos: RelbaseCrearDtePayload["products"] = [];
  for (const [i, l] of pedida.lineas.entries()) {
    const n = i + 1;
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) return fallo(`Línea ${n}: la cantidad debe ser mayor que 0.`);
    if (!Number.isInteger(l.precio) || l.precio <= 0) return fallo(`Línea ${n}: el precio debe ser un monto en pesos, sin decimales.`);
    if (l.productId === PRODUCTO_GENERICO.productId) {
      const d = (l.descripcion ?? "").trim();
      if (!d) return fallo(`Línea ${n}: el producto genérico necesita una descripción.`);
      productos.push({ product_id: l.productId, price: l.precio, quantity: l.cantidad, tax_affected: true, description: d.slice(0, 1000) });
      continue;
    }
    const delCatalogo = enCatalogo.get(l.productId);
    if (delCatalogo) {
      if (delCatalogo.codigo !== l.codigo) return fallo(`Línea ${n}: el producto ${l.codigo} cambió en el catálogo; vuelve a agregarlo.`);
    } else {
      const otro = await obtenerProducto(l.productId);
      if (!otro || otro.code !== l.codigo || otro.enabled === false) {
        return fallo(`Línea ${n}: ${l.codigo} no existe o está deshabilitado en Relbase.`);
      }
    }
    productos.push({ product_id: l.productId, price: l.precio, quantity: l.cantidad, tax_affected: true });
  }
  const neto = Math.round(productos.reduce((s, p) => s + p.price * p.quantity, 0));

  const fecha = fechaHoyDDMMYYYY();
  const tipoDespacho = pedida.tipoDespacho as 1 | 2 | 3;
  const comentario = [`Tipo de despacho: ${TIPOS_DESPACHO[tipoDespacho]}`, pedida.comentario.trim()].filter(Boolean).join(" · ");
  const payload: RelbaseCrearDtePayload = {
    type_document: 52,
    start_date: fecha,
    end_date: fecha,
    customer_id: cliente.id,
    ware_house_id: valores.wareHouseId,
    type_transfer: pedida.tipoTraslado,
    type_dispatch: tipoDespacho,
    comment: comentario.slice(0, 500),
    address: cliente.address,
    city_id: cliente.city_id,
    commune_id: cliente.commune_id,
    contact: pedida.contacto.trim().slice(0, 100),
    products: productos,
    ...(pedida.formaPagoId != null ? { type_payment_id: pedida.formaPagoId } : {}),
    ...(despacho
      ? {
          dispatch_address: despacho.address,
          ...(despacho.city_id ? { dispatch_city_id: despacho.city_id } : {}),
          ...(despacho.commune_id ? { dispatch_commune_id: despacho.commune_id } : {}),
        }
      : {}),
    ...(t.patente ? { number_plate: t.patente.replace(/[\s.-]/g, "").toUpperCase() } : { number_plate_unavailable: true }),
    ...(t.rutTransportista ? { shipper_rut: formatoRut(t.rutTransportista) } : { shipper_rut_unavailable: true }),
    ...(t.rutChofer ? { driver_rut: formatoRut(t.rutChofer) } : { driver_rut_unavailable: true }),
    ...(t.nombreChofer ? { driver_name: t.nombreChofer.trim().slice(0, 100) } : { driver_name_unavailable: true }),
  };

  // --- Registro previo: un segundo envio con la misma llave no emite otra ---
  const supabase = getSupabaseServiceClient();
  const { data: registro, error: errRegistro } = await supabase
    .from("guias_manuales")
    .insert({
      idempotency_key: pedida.idempotencyKey,
      customer_id: cliente.id,
      cliente_rut: cliente.rut,
      cliente_nombre: cliente.name,
      opcion_precio: pedida.opcion,
      monto_neto: neto,
      payload,
      usuario_id: usuario.id,
      usuario: usuario.nombre ?? usuario.email,
    })
    .select("id")
    .single();
  if (errRegistro || !registro) {
    if (errRegistro?.code === "23505") {
      const { data: previa } = await supabase
        .from("guias_manuales")
        .select("estado, folio, dte_id, monto_neto, mensaje_error")
        .eq("idempotency_key", pedida.idempotencyKey)
        .maybeSingle();
      if (previa?.estado === "emitida" && previa.folio && previa.dte_id) {
        return { status: "ok", folio: previa.folio, dteId: Number(previa.dte_id), neto: Number(previa.monto_neto), pdfUrl: null, yaEmitida: true };
      }
      return fallo(
        previa?.estado === "error"
          ? `Esta guía ya se intentó y falló: ${previa.mensaje_error ?? ""}. Revisa en Relbase si quedó emitida antes de intentar de nuevo.`
          : "Esta guía ya se está emitiendo. Espera un momento y revisa en Relbase antes de reintentar."
      );
    }
    return fallo(`No se pudo registrar la guía antes de emitir: ${errRegistro?.message ?? "error desconocido"}. No se emitió nada.`);
  }

  try {
    const creada = await crearGuiaDespacho(payload, uuidDeLlave(pedida.idempotencyKey));
    const folio = String(creada.folio);
    await supabase
      .from("guias_manuales")
      .update({ estado: "emitida", dte_id: creada.id, folio, emitida_en: new Date().toISOString() })
      .eq("id", registro.id);
    const pdfUrl = await obtenerPdfUrlDte(creada.id).catch(() => null);
    // La memoria nunca debe hacer fallar una guia ya emitida.
    await recordar((pedida.aprender ?? []).slice(0, 600), usuario.nombre ?? usuario.email).catch(() => undefined);
    return { status: "ok", folio, dteId: creada.id, neto, pdfUrl };
  } catch (err) {
    // 4xx: Relbase rechazo la guia y no la emitio; se puede corregir y volver
    // a intentar con otra llave. Otro error (5xx, red): pudo quedar emitida.
    const rechazada = err instanceof RelbaseApiError && err.status >= 400 && err.status < 500;
    const mensaje =
      err instanceof RelbaseApiError
        ? `Relbase respondió ${err.status}: ${errorDeRelbase(err)}`
        : err instanceof Error
          ? err.message
          : String(err);
    await supabase.from("guias_manuales").update({ estado: "error", mensaje_error: mensaje }).eq("id", registro.id);
    return rechazada
      ? fallo(`Relbase rechazó la guía y no se emitió. ${mensaje}`, true)
      : fallo(`${mensaje}. La guía pudo haber quedado emitida: revísala en Relbase antes de intentar de nuevo.`);
  }
}
