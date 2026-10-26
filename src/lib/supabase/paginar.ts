import "server-only";

const TAMANO_PAGINA = 1000;
const PAGINAS_EN_PARALELO = 5;

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
  const pedir = async (pagina: number) =>
    (await consulta(pagina * tamanoPagina, (pagina + 1) * tamanoPagina - 1)).data ?? [];

  // La primera sola: casi todas las consultas caben en una pagina.
  const filas: T[] = await pedir(0);
  if (filas.length < tamanoPagina) return filas;

  // Si hay mas, de a PAGINAS_EN_PARALELO a la vez: cada ida y vuelta a Supabase
  // cuesta ~220 ms y una a una el historial tardaba ~3 s (9 paginas,
  // 25-oct-2026). Se arman en orden; la primera pagina incompleta corta.
  for (let siguiente = 1; ; siguiente += PAGINAS_EN_PARALELO) {
    const paginas = await Promise.all(
      Array.from({ length: PAGINAS_EN_PARALELO }, (_, i) => pedir(siguiente + i))
    );
    for (const data of paginas) {
      filas.push(...data);
      if (data.length < tamanoPagina) return filas;
    }
  }
}
