import "server-only";

import { randomUUID } from "node:crypto";
import { createThrottledQueue, withExponentialBackoff } from "./throttle";
import { obtenerAccessToken } from "./token";
import {
  RelbaseApiError,
  type RelbaseCrearDtePayload,
  type RelbaseCrearDteResponse,
  type RelbaseDteDetalle,
  type RelbaseDteResumen,
  type RelbaseCliente,
  type RelbaseDireccionCliente,
  type RelbaseFormaPago,
  type RelbaseProducto,
  type RelbaseProductosPage,
  type RelbaseReferencia,
  type RelbaseTiposTrasladoResponse,
  type RelbaseTipoTraslado,
} from "./types";

/**
 * Cliente de la API v2 de Relbase. La autorizacion sale de la conexion OAuth2
 * guardada en relbase_conexion (ver token.ts y oauth.ts): un admin la conecta
 * una vez desde Empresas y la app renueva el token sola.
 */
const BASE_URL = "https://api.relbase.cl/api/v2";

// 300 req/min por empresa (= 5/s); se deja holgura porque el limite es por
// empresa y puede haber dos invocaciones a la vez.
const queue = createThrottledQueue(4.5);

// v2 sugiere Retry-After: 60 en los 429. Esperar eso dentro de una funcion
// serverless arriesga el limite de ejecucion: se espera como mucho esto.
const MAX_ESPERA_RETRY_AFTER_MS = 15_000;

async function errorDesdeRespuesta(res: Response, path: string): Promise<RelbaseApiError> {
  const body = await res.json().catch(() => undefined);
  const error = new RelbaseApiError(`Relbase API ${res.status} en ${path}`, res.status, body);
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfterMs = Math.min(retryAfter * 1000, MAX_ESPERA_RETRY_AFTER_MS);
  }
  return error;
}

async function enviar(path: string, init: RequestInit) {
  const conToken = (token: string) =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Relbase lo pide en los tickets de soporte para rastrear un request.
        "X-Request-Id": randomUUID(),
        ...init.headers,
      },
    });

  const token = await obtenerAccessToken();
  const res = await conToken(token);
  if (res.status !== 401) return res;
  // Token rechazado aunque pareciera vigente (revocado o rotado por fuera):
  // se fuerza una renovacion y se reintenta una sola vez.
  return conToken(await obtenerAccessToken(token));
}

interface OpcionesRequest {
  /** Reemplaza la regla de reintentos por defecto (ver crearGuiaDespacho). */
  esReintentable?: (err: RelbaseApiError) => boolean;
}

function reintentablePorDefecto(err: RelbaseApiError): boolean {
  // 429 es exceso de tasa. El 403 en v2 es falta de permisos (scope), que no
  // se arregla reintentando. Los 5xx se reintentan: un fallo transitorio del
  // servidor no deberia abortar una lectura.
  return err.status === 429 || err.status >= 500;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { esReintentable = reintentablePorDefecto }: OpcionesRequest = {}
): Promise<T> {
  return queue.schedule(() =>
    withExponentialBackoff(
      async () => {
        const res = await enviar(path, init);
        if (!res.ok) throw await errorDesdeRespuesta(res, path);
        return res.json() as Promise<T>;
      },
      {
        isRetryable: (err) => err instanceof RelbaseApiError && esReintentable(err),
        delayMs: (err) => (err instanceof RelbaseApiError ? err.retryAfterMs : undefined),
      }
    )
  );
}

/** Una pagina del catalogo (12 registros/pagina, confirmado PRD 6.2). */
export async function listarProductosPagina(page: number): Promise<RelbaseProductosPage> {
  return request<RelbaseProductosPage>(`/productos?page=${page}`);
}

/**
 * Busqueda directa por codigo. Respaldo para SKUs que no aparecen en el
 * listado paginado completo (hueco de paginacion confirmado en Relbase,
 * 09-jul-2026): la paginacion por `page` a veces salta productos que
 * `query=<codigo>` sigue encontrando.
 */
export async function buscarProductoPorCodigo(codigo: string): Promise<RelbaseProducto | null> {
  const productos = await buscarProductos(codigo);
  return productos.find((p) => p.code === codigo) ?? null;
}

/**
 * GET /productos/{id}. A diferencia del listado y de ?query=, tambien devuelve
 * los productos deshabilitados (confirmado 25-oct-2026): es la forma de saber
 * si un codigo que "desaparecio" sigue existiendo. null si Relbase no lo tiene.
 */
export async function obtenerProducto(id: number): Promise<RelbaseProducto | null> {
  try {
    // Llega como {data: {...}}; se acepta tambien {data: {product: {...}}}.
    const res = await request<{ data: RelbaseProducto & { product?: RelbaseProducto } }>(`/productos/${id}`);
    return res.data.product ?? res.data;
  } catch (err) {
    if (err instanceof RelbaseApiError && err.status === 404) return null;
    throw err;
  }
}

/** GET /productos?query=: todo lo que Relbase considere parecido, no solo el exacto. */
export async function buscarProductos(query: string): Promise<RelbaseProducto[]> {
  const pagina = await request<RelbaseProductosPage>(
    `/productos?query=${encodeURIComponent(query)}`
  );
  return pagina.data.products;
}

/**
 * Las respuestas de Relbase envuelven la lista en `data` bajo una clave que
 * cambia por endpoint (`products`, `type_transfers`, ...). Como los nombres de
 * las de referencia no estan documentados, se toma el primer array que venga
 * dentro de `data` en vez de adivinar la clave.
 */
function extraerLista(json: unknown): RelbaseReferencia[] {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return [];
  for (const valor of Object.values(data)) {
    if (Array.isArray(valor)) return valor as RelbaseReferencia[];
  }
  return [];
}

/** Solo lectura: clientes de Relbase, para elegir el destinatario de las guias. */
export async function buscarClientesRelbase(query: string): Promise<RelbaseReferencia[]> {
  return extraerLista(await request<unknown>(`/clientes?query=${encodeURIComponent(query)}`));
}

/** Solo lectura: un cliente completo (RUT, razon social, direccion, forma de pago). */
export async function obtenerCliente(id: number): Promise<RelbaseCliente | null> {
  try {
    const res = await request<{ data: RelbaseCliente & { customer?: RelbaseCliente } }>(`/clientes/${id}`);
    return res.data.customer ?? res.data;
  } catch (err) {
    if (err instanceof RelbaseApiError && err.status === 404) return null;
    throw err;
  }
}

/** Solo lectura: direcciones de despacho adicionales del cliente (puede no tener ninguna). */
export async function listarDireccionesCliente(id: number): Promise<RelbaseDireccionCliente[]> {
  const res = await request<{ data: { customer_addresses?: RelbaseDireccionCliente[] } }>(`/clientes/${id}/direcciones`);
  return res.data?.customer_addresses ?? [];
}

/** Solo lectura: formas de pago de la cuenta (scope users:read). */
export async function listarFormasPago(): Promise<RelbaseFormaPago[]> {
  const res = await request<{ data: { type_payments?: RelbaseFormaPago[] } }>("/forma_pagos");
  return (res.data?.type_payments ?? []).filter((f) => f.enabled !== false);
}

export async function listarBodegasRelbase(): Promise<RelbaseReferencia[]> {
  return extraerLista(await request<unknown>("/bodegas"));
}

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function filtrarPorNombre(registros: RelbaseReferencia[], query: string): RelbaseReferencia[] {
  const buscado = normalizar(query);
  if (!buscado) return registros;
  return registros.filter((r) => typeof r.name === "string" && normalizar(r.name).includes(buscado));
}

/**
 * GET /ciudades no filtra: devuelve las ~340 ciudades siempre (confirmado en
 * v2, 24-oct-2026, `?query=` se ignora). Se filtra aca por nombre.
 */
export async function buscarCiudadesRelbase(query: string): Promise<RelbaseReferencia[]> {
  return filtrarPorNombre(extraerLista(await request<unknown>("/ciudades")), query);
}

/**
 * GET /comunas exige `city_id` (v2 responde 400 sin el; confirmado
 * 24-oct-2026): se listan las comunas de la ciudad elegida y se filtran por
 * nombre.
 */
export async function buscarComunasRelbase(
  ciudadId: number,
  query: string
): Promise<RelbaseReferencia[]> {
  return filtrarPorNombre(extraerLista(await request<unknown>(`/comunas?city_id=${ciudadId}`)), query);
}

export async function obtenerTiposTraslado(): Promise<RelbaseTipoTraslado[]> {
  const res = await request<RelbaseTiposTrasladoResponse>("/dtes/guias/tipos_traslado");
  return res.data.type_transfers;
}

/**
 * Crea una guia de despacho (type_document: 52). Efecto irreversible: solo
 * se debe invocar tras confirmacion explicita del usuario (PRD seccion 5).
 */
export async function crearGuiaDespacho(
  payload: RelbaseCrearDtePayload,
  /**
   * Clave estable por guia. Si Relbase la respeta en /dtes, repetir el mismo
   * POST devuelve la guia ya emitida en vez de otra nueva. La spec no marca
   * /dtes como idempotente, asi que no se confia en ella para reintentar.
   */
  idempotencyKey?: string
): Promise<RelbaseCrearDteResponse> {
  // La respuesta viene envuelta en {data: {...}}, igual que el resto de la
  // API (confirmado 11-jul-2026: sin este unwrap, .folio/.id quedan
  // undefined aunque el documento se haya creado correctamente en Relbase).
  const res = await request<{ data: RelbaseCrearDteResponse }>(
    "/dtes",
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...(idempotencyKey ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    },
    {
      // Solo se reintenta el 429, que garantiza que Relbase no proceso el
      // request. Un 5xx no lo garantiza: la guia pudo quedar emitida antes del
      // error y reintentar emitiria otra (un DTE no se deshace).
      esReintentable: (err) => err.status === 429,
    }
  );
  if (!res?.data?.id) {
    // Respondio 2xx sin id: la guia probablemente existe. No se trata como
    // error comun porque quien vea "error" tenderia a reintentar.
    throw new Error(
      "Relbase confirmo la guia pero no devolvio su id. Revisa en Relbase si quedo emitida antes de reintentar."
    );
  }
  return res.data;
}

/** Factura de compra registrada en Relbase (llega del SII o por correo de intercambio). */
export interface CompraRelbase {
  id: number;
  folio: number;
  providerRut: string;
  providerName: string;
  fecha: string;
  neto: number;
  total: number;
  /** false: Relbase solo tiene los totales (sin el XML del proveedor, sin productos). */
  conDetalle: boolean;
}

/**
 * Solo lectura: compras de un proveedor (por RUT; Relbase ya filtra con
 * `query`). Vienen de la mas nueva a la mas antigua (confirmado 28-oct-2026),
 * asi que con `desde` (yyyy-mm-dd) se deja de pedir paginas al pasar esa fecha.
 */
export async function listarComprasProveedor(rut: string, desde?: string): Promise<CompraRelbase[]> {
  const cuerpo = rut.replace(/[^\dkK]/g, "").slice(0, -1);
  const compras: CompraRelbase[] = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const json = await request<{ data: Record<string, unknown>; meta: { total_pages?: number } }>(
      `/compras?query=${encodeURIComponent(cuerpo)}&page=${pagina}`
    );
    totalPaginas = json.meta?.total_pages ?? 1;
    const lista = (Object.values(json.data ?? {}).find(Array.isArray) ?? []) as Record<string, unknown>[];
    for (const c of lista) {
      if (String(c.provider_rut ?? "").replace(/[^\dkK]/g, "").slice(0, -1) !== cuerpo) continue;
      compras.push({
        id: Number(c.id),
        folio: Number(c.folio),
        providerRut: String(c.provider_rut ?? ""),
        providerName: String(c.provider_name ?? ""),
        fecha: String(c.start_date ?? ""),
        neto: Number(c.amount_neto ?? 0),
        total: Number(c.amount_total ?? 0),
        conDetalle: c.is_load_xml === true,
      });
    }
    pagina += 1;
    const ultima = String(lista.at(-1)?.start_date ?? "");
    if (desde && ultima && ultima < desde) break;
  } while (pagina <= totalPaginas);
  return compras;
}

/** Solo lectura: GET /compras/{id}, con sus productos. */
export async function obtenerCompra(id: number): Promise<Record<string, unknown>> {
  const json = await request<{ data: Record<string, unknown> }>(`/compras/${id}`);
  return json.data;
}

/**
 * Solo lectura: una pagina del listado de guias de despacho (12 por pagina,
 * de la mas nueva a la mas antigua; confirmado 25-oct-2026). El listado no
 * trae los productos: para eso, obtenerDte.
 */
export async function listarGuiasPagina(
  page: number
): Promise<{ guias: RelbaseDteResumen[]; totalPaginas: number }> {
  const json = await request<{ data: { dtes?: RelbaseDteResumen[] }; meta: { total_pages?: number } }>(
    `/dtes?type_document=52&page=${page}`
  );
  return { guias: json.data?.dtes ?? [], totalPaginas: json.meta?.total_pages ?? 1 };
}

/** Solo lectura: trae el detalle de un DTE ya creado, incluida la URL (firmada, ~1h) del PDF. */
export async function obtenerDte(id: number): Promise<RelbaseDteDetalle> {
  const res = await request<{ data: RelbaseDteDetalle }>(`/dtes/${id}`);
  return res.data;
}

/**
 * Devuelve la URL del PDF de un DTE reintentando mientras Relbase aun no lo
 * genera. Relbase timbra/genera el PDF de forma asincrona: justo despues de
 * crear la guia, `GET /dtes/{id}` suele traer `pdf_file: null` porque el PDF
 * todavia no esta listo. Sin estos reintentos casi ninguna guia alcanzaba a
 * capturar su PDF (confirmado 29-jul-2026: solo 5 de las guias historicas
 * tenian PDF, todas del primer test).
 *
 * Presupuesto: 6 intentos x 1,5 s = hasta 7,5 s de espera por guia. El primer
 * presupuesto (3 x 1,2 s = 2,4 s) quedo justo en el limite de lo que Relbase
 * tarda: en la corrida del 30-jul-2026 (30 guias) las exitosas encontraban el
 * PDF recien en el ultimo intento y 4 se pasaron por decimas. Se triplico la
 * ventana. Sigue acotado a proposito porque esto corre dentro del loop de
 * generacion (una guia tras otra) y la funcion tiene limite de ejecucion.
 *
 * Devuelve null si el PDF no aparece a tiempo; en ese caso la guia igual queda
 * generada, y como se guarda el dte_id_relbase se puede recuperar despues.
 */
export async function obtenerPdfUrlDte(
  id: number,
  opciones: { intentos?: number; esperaMs?: number } = {}
): Promise<string | null> {
  const { intentos = 6, esperaMs = 1500 } = opciones;
  for (let intento = 0; intento < intentos; intento += 1) {
    const detalle = await obtenerDte(id);
    if (detalle.pdf_file?.url) return detalle.pdf_file.url;
    if (intento < intentos - 1) {
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
  return null;
}

export { RelbaseApiError };
