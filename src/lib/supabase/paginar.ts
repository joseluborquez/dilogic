import "server-only";

const TAMANO_PAGINA = 1000;

/**
 * PostgREST recorta las respuestas (max-rows), asi que un `.limit(5000)` puede
 * devolver menos filas de las que hay sin avisar. Eso es tolerable para leer,
 * pero no para eliminar o armar un ZIP: quedarian filas fuera en silencio.
 * Este helper recorre paginas con `.range()` hasta agotar el resultado.
 *
 * Se recibe la consulta como callback para no perder el tipado que infiere el
 * cliente de Supabase desde el string del `select`.
 *
 * IMPORTANTE: la consulta debe ordenar por algo UNICO (o terminar en `id`).
 * Cada pagina es una consulta aparte, y con un orden ambiguo Postgres no
 * garantiza la misma secuencia entre una y otra: las filas empatadas se
 * reordenan y terminan repetidas en una pagina y ausentes en la siguiente.
 * No es hipotetico: las filas de una guia se insertan juntas y comparten el
 * `created_at` exacto (hasta 191 filas con el mismo valor, 30-jul-2026).
 */
export async function traerTodasLasFilas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>,
  tamanoPagina = TAMANO_PAGINA
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += tamanoPagina) {
    const { data } = await consulta(desde, desde + tamanoPagina - 1);
    if (!data || data.length === 0) break;
    filas.push(...data);
    if (data.length < tamanoPagina) break;
  }
  return filas;
}
