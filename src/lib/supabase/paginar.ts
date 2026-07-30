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
