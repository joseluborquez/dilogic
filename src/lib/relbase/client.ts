import "server-only";

import { randomUUID } from "node:crypto";
import { createThrottledQueue, withExponentialBackoff } from "./throttle";
import { obtenerAccessToken } from "./token";
import {
  RelbaseApiError,
  type RelbaseCrearDtePayload,
  type RelbaseCrearDteResponse,
  type RelbaseCredenciales,
  type RelbaseDteDetalle,
  type RelbaseProducto,
  type RelbaseProductosPage,
  type RelbaseReferencia,
  type RelbaseTiposTrasladoResponse,
  type RelbaseTipoTraslado,
} from "./types";

/**
 * v1 esta por caducar. RELBASE_API_VERSION=v2 cambia todas las llamadas a la
 * API v2 (OAuth2, ver token.ts); sin la variable, o con "v1", sigue todo como
 * antes. Sirve de interruptor para volver atras sin desplegar codigo.
 *
 * En v2 el parametro `credenciales` de cada funcion se ignora: la autorizacion
 * sale de la conexion OAuth guardada en relbase_conexion.
 */
export type VersionRelbase = "v1" | "v2";

export function versionRelbase(): VersionRelbase {
  return process.env.RELBASE_API_VERSION === "v2" ? "v2" : "v1";
}

/**
 * Emitir guias con v2 queda bloqueado hasta la prueba controlada (Paso 6 de
 * la migracion): son DTEs ante el SII y no se emiten con una integracion sin
 * verificar. RELBASE_V2_EMISION_HABILITADA=true lo habilita.
 */
export function emisionBloqueadaEnV2(): boolean {
  return versionRelbase() === "v2" && process.env.RELBASE_V2_EMISION_HABILITADA !== "true";
}

const BASE_URL: Record<VersionRelbase, string> = {
  v1: "https://api.relbase.cl/api/v1",
  v2: "https://api.relbase.cl/api/v2",
};

// v1: 7 req/s. v2: 300 req/min por empresa (= 5/s); se deja holgura porque el
// limite es por empresa y puede haber dos invocaciones a la vez.
const queues: Record<VersionRelbase, ReturnType<typeof createThrottledQueue>> = {
  v1: createThrottledQueue(7),
  v2: createThrottledQueue(4.5),
};

// v2 sugiere Retry-After: 60 en los 429. Esperar eso dentro de una funcion
// serverless arriesga el limite de ejecucion: se espera como mucho esto.
const MAX_ESPERA_RETRY_AFTER_MS = 15_000;

function authHeadersV1(credenciales: RelbaseCredenciales): HeadersInit {
  return {
    company: credenciales.tokenEmpresa,
    authorization: credenciales.tokenUsuarioIntegrador,
    "Content-Type": "application/json",
  };
}

async function errorDesdeRespuesta(res: Response, path: string): Promise<RelbaseApiError> {
  const body = await res.json().catch(() => undefined);
  const error = new RelbaseApiError(`Relbase API ${res.status} en ${path}`, res.status, body);
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfterMs = Math.min(retryAfter * 1000, MAX_ESPERA_RETRY_AFTER_MS);
  }
  return error;
}

async function fetchV1(path: string, credenciales: RelbaseCredenciales, init: RequestInit) {
  return fetch(`${BASE_URL.v1}${path}`, {
    ...init,
    headers: { ...authHeadersV1(credenciales), ...init.headers },
  });
}

async function fetchV2(path: string, init: RequestInit) {
  const enviar = (token: string) =>
    fetch(`${BASE_URL.v2}${path}`, {
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
  const res = await enviar(token);
  if (res.status !== 401) return res;
  // Token rechazado aunque pareciera vigente (revocado o rotado por fuera):
  // se fuerza una renovacion y se reintenta una sola vez.
  return enviar(await obtenerAccessToken(token));
}

interface OpcionesRequest {
  /** Reemplaza la regla de reintentos por defecto (ver crearGuiaDespacho). */
  esReintentable?: (err: RelbaseApiError, version: VersionRelbase) => boolean;
}

function reintentablePorDefecto(err: RelbaseApiError, version: VersionRelbase): boolean {
  // v1 señala el exceso de tasa con 403; v2 con 429, y en v2 el 403 es falta
  // de permisos (scope), que no se arregla reintentando. Los 5xx se
  // reintentan en ambas: antes un fallo transitorio del servidor abortaba la
  // guia sin ningun reintento.
  return (version === "v1" && err.status === 403) || err.status === 429 || err.status >= 500;
}

async function request<T>(
  path: string,
  credenciales: RelbaseCredenciales,
  init: RequestInit = {},
  { esReintentable = reintentablePorDefecto }: OpcionesRequest = {}
): Promise<T> {
  const version = versionRelbase();
  return queues[version].schedule(() =>
    withExponentialBackoff(
      async () => {
        const res =
          version === "v2" ? await fetchV2(path, init) : await fetchV1(path, credenciales, init);
        if (!res.ok) throw await errorDesdeRespuesta(res, path);
        return res.json() as Promise<T>;
      },
      {
        isRetryable: (err) => err instanceof RelbaseApiError && esReintentable(err, version),
        delayMs: (err) => (err instanceof RelbaseApiError ? err.retryAfterMs : undefined),
      }
    )
  );
}

export async function listarProductosPagina(
  credenciales: RelbaseCredenciales,
  page: number
): Promise<RelbaseProductosPage> {
  return request<RelbaseProductosPage>(`/productos?page=${page}`, credenciales);
}

/** Trae todas las paginas (12 registros/pagina, confirmado PRD 6.2). */
export async function listarTodosLosProductos(
  credenciales: RelbaseCredenciales
): Promise<RelbaseProducto[]> {
  const productos: RelbaseProducto[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const pagina = await listarProductosPagina(credenciales, page);
    productos.push(...pagina.data.products);
    totalPages = pagina.meta.total_pages;
    page += 1;
  } while (page <= totalPages);
  return productos;
}

/**
 * Busqueda directa por codigo. Respaldo para SKUs que no aparecen en el
 * listado paginado completo (hueco de paginacion confirmado en Relbase,
 * 09-jul-2026): la paginacion por `page` a veces salta productos que
 * `query=<codigo>` sigue encontrando.
 */
export async function buscarProductoPorCodigo(
  credenciales: RelbaseCredenciales,
  codigo: string
): Promise<RelbaseProducto | null> {
  const pagina = await request<RelbaseProductosPage>(
    `/productos?query=${encodeURIComponent(codigo)}`,
    credenciales
  );
  return pagina.data.products.find((p) => p.code === codigo) ?? null;
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
export async function buscarClientesRelbase(
  credenciales: RelbaseCredenciales,
  query: string
): Promise<RelbaseReferencia[]> {
  const json = await request<unknown>(
    `/clientes?query=${encodeURIComponent(query)}`,
    credenciales
  );
  return extraerLista(json);
}

export async function listarBodegasRelbase(
  credenciales: RelbaseCredenciales
): Promise<RelbaseReferencia[]> {
  return extraerLista(await request<unknown>("/bodegas", credenciales));
}

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
export async function buscarCiudadesRelbase(
  credenciales: RelbaseCredenciales,
  query: string
): Promise<RelbaseReferencia[]> {
  const json = await request<unknown>("/ciudades", credenciales);
  return filtrarPorNombre(extraerLista(json), query);
}

/**
 * GET /comunas exige `city_id` (v2 responde 400 sin el; confirmado
 * 24-oct-2026): se listan las comunas de la ciudad elegida y se filtran por
 * nombre.
 */
export async function buscarComunasRelbase(
  credenciales: RelbaseCredenciales,
  ciudadId: number,
  query: string
): Promise<RelbaseReferencia[]> {
  const json = await request<unknown>(`/comunas?city_id=${ciudadId}`, credenciales);
  return filtrarPorNombre(extraerLista(json), query);
}

export async function obtenerTiposTraslado(
  credenciales: RelbaseCredenciales
): Promise<RelbaseTipoTraslado[]> {
  const res = await request<RelbaseTiposTrasladoResponse>(
    "/dtes/guias/tipos_traslado",
    credenciales
  );
  return res.data.type_transfers;
}

/**
 * Crea una guia de despacho (type_document: 52). Efecto irreversible: solo
 * se debe invocar tras confirmacion explicita del usuario (PRD seccion 5).
 */
export async function crearGuiaDespacho(
  credenciales: RelbaseCredenciales,
  payload: RelbaseCrearDtePayload,
  /**
   * v2: clave estable por guia. Si Relbase la respeta en /dtes, repetir el
   * mismo POST devuelve la guia ya emitida en vez de otra nueva. La spec no
   * marca /dtes como idempotente, asi que no se confia en ella para reintentar.
   */
  idempotencyKey?: string
): Promise<RelbaseCrearDteResponse> {
  if (emisionBloqueadaEnV2()) {
    throw new Error("La emision de guias con Relbase v2 aun no esta habilitada.");
  }
  // La respuesta viene envuelta en {data: {...}}, igual que el resto de la
  // API (confirmado 11-jul-2026: sin este unwrap, .folio/.id quedan
  // undefined aunque el documento se haya creado correctamente en Relbase).
  const res = await request<{ data: RelbaseCrearDteResponse }>(
    "/dtes",
    credenciales,
    {
      method: "POST",
      body: JSON.stringify(payload),
      ...(versionRelbase() === "v2" && idempotencyKey
        ? { headers: { "Idempotency-Key": idempotencyKey } }
        : {}),
    },
    {
      // En v2 solo se reintenta el 429, que garantiza que Relbase no proceso
      // el request. Un 5xx no lo garantiza: la guia pudo quedar emitida antes
      // del error y reintentar emitiria otra (un DTE no se deshace).
      esReintentable: (err, version) =>
        version === "v2" ? err.status === 429 : reintentablePorDefecto(err, version),
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

/** Solo lectura: trae el detalle de un DTE ya creado, incluida la URL (firmada, ~1h) del PDF. */
export async function obtenerDte(
  credenciales: RelbaseCredenciales,
  id: number
): Promise<RelbaseDteDetalle> {
  const res = await request<{ data: RelbaseDteDetalle }>(`/dtes/${id}`, credenciales);
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
  credenciales: RelbaseCredenciales,
  id: number,
  opciones: { intentos?: number; esperaMs?: number } = {}
): Promise<string | null> {
  const { intentos = 6, esperaMs = 1500 } = opciones;
  for (let intento = 0; intento < intentos; intento += 1) {
    const detalle = await obtenerDte(credenciales, id);
    if (detalle.pdf_file?.url) return detalle.pdf_file.url;
    if (intento < intentos - 1) {
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
  return null;
}

export { RelbaseApiError };
