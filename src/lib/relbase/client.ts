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

export { RelbaseApiError };
