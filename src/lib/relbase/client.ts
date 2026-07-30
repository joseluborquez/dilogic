import "server-only";

import { createThrottledQueue, withExponentialBackoff } from "./throttle";
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

const BASE_URL = "https://api.relbase.cl/api/v1";
const MAX_REQ_PER_SECOND = 7;

// Compartida por request a este modulo: dentro de una misma invocacion del
// route handler, todas las llamadas a Relbase pasan por esta cola.
const queue = createThrottledQueue(MAX_REQ_PER_SECOND);

function authHeaders(credenciales: RelbaseCredenciales): HeadersInit {
  return {
    company: credenciales.tokenEmpresa,
    authorization: credenciales.tokenUsuarioIntegrador,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  path: string,
  credenciales: RelbaseCredenciales,
  init: RequestInit = {}
): Promise<T> {
  return queue.schedule(() =>
    withExponentialBackoff(
      async () => {
        const res = await fetch(`${BASE_URL}${path}`, {
          ...init,
          headers: { ...authHeaders(credenciales), ...init.headers },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => undefined);
          throw new RelbaseApiError(
            `Relbase API ${res.status} en ${path}`,
            res.status,
            body
          );
        }

        return res.json() as Promise<T>;
      },
      { isRetryable: (err) => err instanceof RelbaseApiError && err.status === 403 }
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

export async function buscarCiudadesRelbase(
  credenciales: RelbaseCredenciales,
  query: string
): Promise<RelbaseReferencia[]> {
  const json = await request<unknown>(
    `/ciudades?query=${encodeURIComponent(query)}`,
    credenciales
  );
  return extraerLista(json);
}

export async function buscarComunasRelbase(
  credenciales: RelbaseCredenciales,
  query: string
): Promise<RelbaseReferencia[]> {
  const json = await request<unknown>(
    `/comunas?query=${encodeURIComponent(query)}`,
    credenciales
  );
  return extraerLista(json);
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
  payload: RelbaseCrearDtePayload
): Promise<RelbaseCrearDteResponse> {
  // La respuesta viene envuelta en {data: {...}}, igual que el resto de la
  // API (confirmado 11-jul-2026: sin este unwrap, .folio/.id quedan
  // undefined aunque el documento se haya creado correctamente en Relbase).
  const res = await request<{ data: RelbaseCrearDteResponse }>("/dtes", credenciales, {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
