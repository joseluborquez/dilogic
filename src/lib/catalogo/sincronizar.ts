import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { enLotes } from "@/lib/util/lotes";
import {
  buscarProductoPorCodigo,
  listarProductosPagina,
} from "@/lib/relbase/client";
import type { OrigenSincronizacion } from "@/lib/supabase/types";
import { PAGINAS_POR_LOTE } from "./constantes";

export interface ResumenEmpresa {
  codigoInterno: string;
  total: number;
  conMatch: number;
  sinMatch: string[];
}

export interface ResumenSincronizacion {
  totalProductosRelbase: number;
  porEmpresa: ResumenEmpresa[];
  /** Indice del catalogo desde donde debe continuar la proxima llamada. */
  siguienteIndice: number;
  quedanMas: boolean;
}

export interface ResultadoLote {
  totalPages: number;
  hastaPagina: number;
  actualizados: number;
  /** SKUs que estaban en Relbase y no en productos_catalogo: se dieron de alta. */
  insertados: string[];
  /** Codigos activos cuyo producto de Relbase hoy tiene otro codigo. */
  codigosCambiados: CodigoCambiado[];
}

/**
 * Un codigo del catalogo cuyo product_id ahora lleva otro codigo en Relbase:
 * alguien recodifico (o reutilizo) el producto alla. Casos reales: CERQ_FV_090
 * paso a CERQ_FV_310 (mismo producto), pero YDR_AS_011 "caja aislapol 70 lb"
 * paso a YDR_FV_100 "CAJA PLASTICA" (otro producto). No se corrige solo:
 * decidir si el codigo viejo sigue valido es del negocio.
 */
export interface CodigoCambiado {
  sku: string;
  descripcion: string | null;
  codigoRelbase: string | null;
  nombreRelbase: string | null;
}

/** Lo que la sincronizacion vio de un producto en Relbase. */
interface ProductoVisto {
  id: number;
  precio: number | null;
  nombre: string | null;
  descripcionRelbase: string | null;
  habilitado: boolean;
}

const MOTIVO_NO_EXISTE = "El código ya no existe en Relbase.";
const MOTIVO_DESHABILITADO = "El producto está deshabilitado en Relbase.";

/** Fechas como Date: Postgres devuelve "+00:00" y JS "Z", y como texto no se comparan bien. */
function vistoDesde(ultimaSincronizacion: string | null, inicio: string): boolean {
  return (
    ultimaSincronizacion != null &&
    new Date(ultimaSincronizacion).getTime() >= new Date(inicio).getTime()
  );
}

/**
 * Guarda lo visto en Relbase para una fila del catalogo. Que
 * ultima_sincronizacion quede posterior al inicio de la sincronizacion es lo
 * que marca la fila como "vista" (ver aplicarEstadoRelbase).
 */
async function registrarVisto(id: string, producto: ProductoVisto): Promise<void> {
  await getSupabaseServiceClient()
    .from("productos_catalogo")
    .update({
      product_id_relbase: producto.id,
      // Solo si Relbase trae un precio valido: escribir null aca borraria el
      // precio ya guardado.
      ...(producto.precio !== null ? { precio: producto.precio } : {}),
      descripcion_relbase: producto.descripcionRelbase,
      nombre_relbase: producto.nombre,
      habilitado_relbase: producto.habilitado,
      ultima_sincronizacion: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Un codigo de Relbase se da de alta solo si sigue el patron
 * EMPRESA_FAMILIA_NUMERO (ej. MTX_AB_234) y EMPRESA es el codigo_interno de una
 * empresa registrada. Relbase tiene ~1150 productos de otros formatos que no
 * son de Dilogic: sin este filtro entrarian todos al catalogo.
 */
function empresaYFamiliaDeSku(
  sku: string,
  empresaIdPorCodigo: Map<string, string>
): { empresaId: string; familia: string } | null {
  const partes = sku.split("_");
  if (partes.length !== 3) return null;
  const [codigoEmpresa, familia, numero] = partes;
  if (!/^[A-Z]+$/.test(familia) || !/^\d+$/.test(numero)) return null;
  const empresaId = empresaIdPorCodigo.get(codigoEmpresa);
  return empresaId ? { empresaId, familia } : null;
}

/**
 * Sincroniza un lote de paginas de Relbase (solo lectura hacia Relbase) y
 * actualiza los matches encontrados en productos_catalogo. Disenado para
 * ser llamado repetidamente desde el cliente (paginas [startPage,
 * startPage + cantidadPaginas - 1]) en vez de una sola invocacion larga,
 * porque el sync completo mide ~2.6 min en la practica (163 paginas) y
 * excederia el limite de duracion de una funcion serverless en Vercel.
 */
export async function sincronizarLotePaginas(
  startPage: number,
  cantidadPaginas: number
): Promise<ResultadoLote> {
  const supabase = getSupabaseServiceClient();

  const porCodigo = new Map<string, ProductoVisto>();
  // Por id, para detectar codigos del catalogo cuyo producto se recodifico.
  const porId = new Map<number, { code: string | null; name: string | null }>();
  let totalPages = startPage; // se corrige con la respuesta de la primera pagina del lote

  for (let page = startPage; page < startPage + cantidadPaginas; page++) {
    const pagina = await listarProductosPagina(page);
    totalPages = pagina.meta.total_pages;
    if (page > totalPages) break;
    for (const p of pagina.data.products) {
      porId.set(p.id, { code: p.code, name: p.name ?? null });
      if (!p.code) continue;
      // Sin Number.isFinite, un producto sin precio en Relbase daba NaN, que
      // se serializa como null y borraba en silencio el precio guardado. Se
      // guarda como null y mas abajo se omite del update, en vez de descartar
      // el producto entero: asi igual se sincroniza su product_id.
      const precio = Number(p.price);
      porCodigo.set(p.code, {
        id: p.id,
        precio: Number.isFinite(precio) ? precio : null,
        nombre: p.name ?? null,
        descripcionRelbase: p.description ?? null,
        // Relbase manda `enabled: false` para productos deshabilitados; si no
        // viniera el campo se asume habilitado.
        habilitado: p.enabled !== false,
      });
    }
  }

  const nuestroCatalogo = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, sku, descripcion, product_id_relbase, activo")
      .order("sku")
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const actualizaciones = nuestroCatalogo.flatMap((row) => {
    const match = porCodigo.get(row.sku);
    return match ? [{ id: row.id, producto: match }] : [];
  });

  // De a 10: un Promise.all sobre la lista completa abriria cientos de
  // conexiones simultaneas a Supabase desde un solo lambda, y la lista crece
  // con cada empresa nueva.
  await enLotes(actualizaciones, 10, (u) => registrarVisto(u.id, u.producto));

  const insertados = await darDeAltaCodigosNuevos(porCodigo, new Set(nuestroCatalogo.map((r) => r.sku)));

  // Cada producto de Relbase aparece en una sola pagina, asi que al recorrer
  // todos los lotes cada product_id se revisa una vez.
  const codigosCambiados: CodigoCambiado[] = [];
  for (const row of nuestroCatalogo) {
    if (!row.activo || row.product_id_relbase == null) continue;
    const actual = porId.get(Number(row.product_id_relbase));
    if (actual && actual.code !== row.sku) {
      codigosCambiados.push({
        sku: row.sku,
        descripcion: row.descripcion,
        codigoRelbase: actual.code,
        nombreRelbase: actual.name,
      });
    }
  }

  return {
    totalPages,
    hastaPagina: Math.min(startPage + cantidadPaginas - 1, totalPages),
    actualizados: actualizaciones.length,
    insertados,
    codigosCambiados,
  };
}

/**
 * Da de alta en productos_catalogo los codigos que Relbase ya tiene y nosotros
 * no. Hasta el 31-jul-2026 la sincronizacion solo hacia UPDATE sobre filas
 * existentes, asi que un producto creado en Relbase despues de cargar
 * CODIGOS DILOGIC.xlsx fallaba para siempre con "El codigo no existe en el
 * catalogo de esta empresa" y volver a sincronizar no lo arreglaba nunca
 * (paso con MTX_AB_234, MTX_CC_165 y CERQ_FV_310).
 */
async function darDeAltaCodigosNuevos(
  porCodigo: Map<string, ProductoVisto>,
  skusExistentes: Set<string>
): Promise<string[]> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id, codigo_interno");
  if (errEmpresas || !empresas) return [];
  const empresaIdPorCodigo = new Map(empresas.map((e) => [e.codigo_interno, e.id]));

  const nuevos: {
    empresa_id: string;
    sku: string;
    product_id_relbase: number;
    descripcion: string | null;
    descripcion_relbase: string | null;
    precio: number | null;
    familia: string;
    activo: boolean;
    nombre_relbase: string | null;
    habilitado_relbase: boolean;
    motivo_bloqueo: string | null;
    bloqueado_por: "relbase" | null;
    ultima_sincronizacion: string;
  }[] = [];

  for (const [sku, p] of porCodigo) {
    if (skusExistentes.has(sku)) continue;
    const destino = empresaYFamiliaDeSku(sku, empresaIdPorCodigo);
    if (!destino) continue;
    nuevos.push({
      empresa_id: destino.empresaId,
      sku,
      product_id_relbase: p.id,
      descripcion: p.nombre,
      descripcion_relbase: p.descripcionRelbase,
      precio: p.precio,
      familia: destino.familia,
      // Uno deshabilitado en Relbase entra ya bloqueado: se vera en la
      // sincronizacion si vuelve a habilitarse.
      activo: p.habilitado,
      nombre_relbase: p.nombre,
      habilitado_relbase: p.habilitado,
      motivo_bloqueo: p.habilitado ? null : MOTIVO_DESHABILITADO,
      bloqueado_por: p.habilitado ? null : "relbase",
      ultima_sincronizacion: new Date().toISOString(),
    });
  }

  if (nuevos.length === 0) return [];

  // ignoreDuplicates contra unique (empresa_id, sku): si otro lote en curso ya
  // lo inserto, no se pisa lo que haya.
  const { error } = await supabase
    .from("productos_catalogo")
    .upsert(nuevos, { onConflict: "empresa_id,sku", ignoreDuplicates: true });
  if (error) throw new Error(`No se pudieron dar de alta los códigos nuevos: ${error.message}`);

  return nuevos.map((n) => n.sku).sort();
}

/**
 * Cuantos pendientes resuelve cada llamada. Cada uno es una consulta a Relbase
 * en serie (~0,5 s), asi que el lote acota la duracion de la funcion.
 *
 * Antes se procesaban todos de una vez, apoyandose en que eran ~10: eso valia
 * cuando las empresas se cargaban a mano y sus productos ya existian en
 * Relbase. Una empresa creada desde la app puede llegar con 250 pendientes de
 * golpe, y ahi la funcion se pasaba del tiempo maximo.
 */
const PENDIENTES_POR_LOTE = 40;

export async function sincronizarPendientesDirecto(
  desdeIndice = 0,
  /**
   * Inicio de la sincronizacion en curso. Tambien se buscan por codigo los que
   * el listado paginado no mostro desde entonces: la paginacion de Relbase
   * tiene huecos, y sin esta busqueda un codigo valido se bloquearia como
   * "no existe en Relbase".
   */
  inicio?: string
): Promise<ResumenSincronizacion> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id, codigo_interno")
    .eq("activo", true);
  if (errEmpresas || !empresas) throw new Error("No hay empresas activas configuradas.");

  // Paginado: PostgREST corta en max-rows. Con ~800 SKUs y tres empresas la
  // consulta entera cabia, pero cada empresa nueva suma ~250 y los que
  // quedaran fuera nunca se sincronizarian (ni se notaria).
  const nuestroCatalogo = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, sku, empresa_id, product_id_relbase, ultima_sincronizacion")
      .order("sku")
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const codigoPorEmpresaId = new Map(empresas.map((e) => [e.id, e.codigo_interno]));
  const sinMatchFinal: { sku: string; codigoEmpresa: string }[] = [];

  // Se avanza por indice sobre el catalogo COMPLETO (orden estable), no sobre
  // la lista filtrada de pendientes: un SKU que no existe en Relbase sigue
  // pendiente despues de intentarlo, y recorrer "los primeros N pendientes"
  // volveria a intentar los mismos para siempre.
  const pendientes: typeof nuestroCatalogo = [];
  let indice = Math.max(0, desdeIndice);
  while (indice < nuestroCatalogo.length && pendientes.length < PENDIENTES_POR_LOTE) {
    const fila = nuestroCatalogo[indice];
    const noVisto = inicio != null && !vistoDesde(fila.ultima_sincronizacion, inicio);
    if (fila.product_id_relbase == null || noVisto) pendientes.push(fila);
    indice += 1;
  }

  for (const p of pendientes) {
    const producto = await buscarProductoPorCodigo(p.sku);
    const codigoEmpresa = codigoPorEmpresaId.get(p.empresa_id) ?? "?";
    if (producto) {
      const precio = Number(producto.price);
      await registrarVisto(p.id, {
        id: producto.id,
        precio: Number.isFinite(precio) ? precio : null,
        nombre: producto.name ?? null,
        descripcionRelbase: producto.description ?? null,
        habilitado: producto.enabled !== false,
      });
    } else {
      sinMatchFinal.push({ sku: p.sku, codigoEmpresa });
    }
  }

  // El resumen se calcula desde el estado real de la base y no desde lo
  // intentado en esta llamada: al procesar por lotes, `sinMatchFinal` solo
  // conoce el ultimo lote y el total quedaria subestimado.
  const catalogoFinal = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, empresa_id, sku, product_id_relbase")
      .order("id")
      .range(desde, hasta)
  );

  const porEmpresa: ResumenEmpresa[] = empresas.map((e) => {
    const filasEmpresa = catalogoFinal.filter((r) => r.empresa_id === e.id);
    const sinMatch = filasEmpresa.filter((r) => r.product_id_relbase == null).map((r) => r.sku);
    return {
      codigoInterno: e.codigo_interno,
      total: filasEmpresa.length,
      conMatch: filasEmpresa.length - sinMatch.length,
      sinMatch,
    };
  });

  return {
    totalProductosRelbase: 0, // no aplica en este paso puntual
    porEmpresa,
    // Desde donde sigue el proximo lote. Siempre avanza, asi que el ciclo del
    // cliente termina aunque ningun SKU del lote se haya podido resolver.
    siguienteIndice: indice,
    quedanMas: indice < nuestroCatalogo.length,
  };
}

// ---------------------------------------------------------------------------
// Aplicar el estado de Relbase y orquestar una sincronizacion completa
// ---------------------------------------------------------------------------

export interface CambioEstado {
  sku: string;
  descripcion: string | null;
  motivo: string;
}

export interface ResultadoEstado {
  bloqueados: CambioEstado[];
  reactivados: CambioEstado[];
}

/**
 * Si una sincronizacion fuera a bloquear mas que esto, algo anda mal del lado
 * de Relbase (una respuesta truncada, un listado vacio) y no del catalogo: se
 * aborta sin tocar nada. Hoy un cambio real son 5 codigos de 823.
 */
const MAX_BLOQUEOS_SIN_REVISAR = (total: number) => Math.max(15, Math.ceil(total * 0.05));

/**
 * Al terminar una sincronizacion completa (listado + busqueda directa de los
 * no vistos), alinea `activo` con Relbase:
 * - bloquea los activos que no se vieron (su codigo ya no existe alla) o que
 *   Relbase tiene deshabilitados;
 * - reactiva los que la propia sincronizacion habia bloqueado y volvieron.
 * Los bloqueos manuales (bloqueado_por = 'manual') no se tocan.
 */
export async function aplicarEstadoRelbase(
  inicio: string,
  /** sku -> codigo actual en Relbase, para explicar mejor el bloqueo. */
  recodificados: Map<string, string | null> = new Map()
): Promise<ResultadoEstado> {
  const supabase = getSupabaseServiceClient();
  const filas = await traerTodasLasFilas((desde, hasta) =>
    supabase
      .from("productos_catalogo")
      .select("id, sku, descripcion, activo, bloqueado_por, habilitado_relbase, ultima_sincronizacion")
      .order("sku")
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const aBloquear: { id: string; cambio: CambioEstado }[] = [];
  const aReactivar: { id: string; cambio: CambioEstado }[] = [];

  for (const f of filas) {
    const visto = vistoDesde(f.ultima_sincronizacion, inicio);
    const habilitado = f.habilitado_relbase !== false;
    if (f.activo && (!visto || !habilitado)) {
      const nuevoCodigo = recodificados.get(f.sku);
      const motivo = !visto
        ? nuevoCodigo
          ? `${MOTIVO_NO_EXISTE} Relbase le cambió el código a ${nuevoCodigo}.`
          : MOTIVO_NO_EXISTE
        : MOTIVO_DESHABILITADO;
      aBloquear.push({ id: f.id, cambio: { sku: f.sku, descripcion: f.descripcion, motivo } });
    } else if (!f.activo && f.bloqueado_por === "relbase" && visto && habilitado) {
      aReactivar.push({
        id: f.id,
        cambio: { sku: f.sku, descripcion: f.descripcion, motivo: "Volvió a estar disponible en Relbase." },
      });
    }
  }

  const tope = MAX_BLOQUEOS_SIN_REVISAR(filas.length);
  if (aBloquear.length > tope) {
    throw new Error(
      `La sincronización iba a bloquear ${aBloquear.length} códigos (el máximo sin revisión es ${tope}). No se bloqueó nada: puede ser una respuesta incompleta de Relbase. Ejemplos: ${aBloquear
        .slice(0, 5)
        .map((b) => b.cambio.sku)
        .join(", ")}.`
    );
  }

  await enLotes(aBloquear, 10, async ({ id, cambio }) => {
    await supabase
      .from("productos_catalogo")
      .update({ activo: false, bloqueado_por: "relbase", motivo_bloqueo: cambio.motivo })
      .eq("id", id);
  });
  await enLotes(aReactivar, 10, async ({ id }) => {
    await supabase
      .from("productos_catalogo")
      .update({ activo: true, bloqueado_por: null, motivo_bloqueo: null })
      .eq("id", id);
  });

  return {
    bloqueados: aBloquear.map((b) => b.cambio),
    reactivados: aReactivar.map((r) => r.cambio),
  };
}

export interface ResumenSincronizacionCompleta extends ResultadoEstado {
  actualizados: number;
  insertados: string[];
  codigosCambiados: CodigoCambiado[];
}

/** Abre el registro de una sincronizacion. `inicio` marca que filas se "vieron". */
export async function iniciarRegistroSincronizacion(
  origen: OrigenSincronizacion
): Promise<{ id: string; inicio: string }> {
  const inicio = new Date().toISOString();
  const { data, error } = await getSupabaseServiceClient()
    .from("sincronizaciones_catalogo")
    .insert({ origen, iniciada_en: inicio, estado: "en_curso" })
    .select("id")
    .single();
  if (error || !data) throw new Error("No se pudo registrar el inicio de la sincronización.");
  return { id: data.id, inicio };
}

export async function cerrarRegistroSincronizacion(
  id: string,
  resultado: { resumen: ResumenSincronizacionCompleta } | { error: string }
): Promise<void> {
  await getSupabaseServiceClient()
    .from("sincronizaciones_catalogo")
    .update({
      terminada_en: new Date().toISOString(),
      ...("error" in resultado
        ? { estado: "error", error: resultado.error }
        : { estado: "ok", resumen: resultado.resumen }),
    })
    .eq("id", id);
}

export interface UltimaSincronizacion {
  origen: OrigenSincronizacion;
  iniciadaEn: string;
  terminadaEn: string | null;
  estado: "en_curso" | "ok" | "error";
  error: string | null;
  resumen: ResumenSincronizacionCompleta | null;
}

export async function obtenerUltimaSincronizacion(): Promise<UltimaSincronizacion | null> {
  const { data } = await getSupabaseServiceClient()
    .from("sincronizaciones_catalogo")
    .select("origen, iniciada_en, terminada_en, estado, error, resumen")
    .order("iniciada_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    origen: data.origen,
    iniciadaEn: data.iniciada_en,
    terminadaEn: data.terminada_en,
    estado: data.estado,
    error: data.error,
    resumen: (data.resumen as ResumenSincronizacionCompleta | null) ?? null,
  };
}

/**
 * Sincronizacion completa en una sola invocacion, para la tarea automatica
 * diaria (maxDuration 300 s; hoy tarda ~2 min). El boton de Catalogo hace lo
 * mismo en pasos desde el navegador.
 */
export async function sincronizarCatalogoCompleto(
  origen: OrigenSincronizacion
): Promise<ResumenSincronizacionCompleta> {
  const { id, inicio } = await iniciarRegistroSincronizacion(origen);
  try {
    let page = 1;
    let totalPages = 1;
    let actualizados = 0;
    const insertados: string[] = [];
    const codigosCambiados: CodigoCambiado[] = [];
    do {
      const lote = await sincronizarLotePaginas(page, PAGINAS_POR_LOTE);
      totalPages = lote.totalPages;
      actualizados += lote.actualizados;
      insertados.push(...lote.insertados);
      codigosCambiados.push(...lote.codigosCambiados);
      page = lote.hastaPagina + 1;
    } while (page <= totalPages);

    let pendientes = await sincronizarPendientesDirecto(0, inicio);
    while (pendientes.quedanMas) {
      pendientes = await sincronizarPendientesDirecto(pendientes.siguienteIndice, inicio);
    }

    const estado = await aplicarEstadoRelbase(
      inicio,
      new Map(codigosCambiados.map((c) => [c.sku, c.codigoRelbase]))
    );
    const resumen = { actualizados, insertados: insertados.sort(), codigosCambiados, ...estado };
    await cerrarRegistroSincronizacion(id, { resumen });
    return resumen;
  } catch (err) {
    await cerrarRegistroSincronizacion(id, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
