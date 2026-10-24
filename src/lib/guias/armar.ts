/**
 * Reparte las filas de un pedido en guias de despacho. Lo usan la pantalla
 * (para anunciar cuantas guias saldran) y el servidor (para emitirlas): asi lo
 * anunciado es exactamente lo emitido.
 *
 * - Separado (por defecto): una guia por centro y categoria (AB, CC, FV...),
 *   partida en lotes de MAX_PRODUCTOS_POR_GUIA.
 * - Agrupado: una sola secuencia por centro, sin separar categorias, partida en
 *   lotes de MAX_PRODUCTOS_POR_GUIA: la menor cantidad posible de guias. Las
 *   filas se ordenan por categoria para que cada guia mezcle lo menos posible.
 */

// Relbase rechaza cualquier documento electronico con mas de 60 productos.
export const MAX_PRODUCTOS_POR_GUIA = 60;

export interface FilaRepartible {
  fila: number;
  centro: string | null;
  categoria: string | null;
}

export interface GuiaArmada<T extends FilaRepartible> {
  centro: string;
  /** Categoria de la guia; agrupada con varias, "AB+CC+FV". */
  categoria: string | null;
  filas: T[];
}

function dividirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

function etiquetaCategorias(filas: FilaRepartible[]): string | null {
  const categorias = [...new Set(filas.map((f) => f.categoria).filter((c): c is string => !!c))].sort();
  return categorias.length > 0 ? categorias.join("+") : null;
}

/**
 * @param contactoManual centro para las filas sin centro propio (formato
 * largo, donde el contacto se ingresa a mano).
 */
export function armarGuias<T extends FilaRepartible>(
  filas: T[],
  contactoManual: string,
  agrupar: boolean
): GuiaArmada<T>[] {
  // Map conserva el orden de aparicion: los centros salen en el orden del archivo.
  const grupos = new Map<string, { centro: string; categoria: string | null; filas: T[] }>();
  for (const fila of filas) {
    const centro = fila.centro ?? contactoManual;
    const clave = agrupar ? centro : `${centro}::${fila.categoria ?? ""}`;
    if (!grupos.has(clave)) grupos.set(clave, { centro, categoria: fila.categoria, filas: [] });
    grupos.get(clave)!.filas.push(fila);
  }

  const guias: GuiaArmada<T>[] = [];
  for (const grupo of grupos.values()) {
    const ordenadas = agrupar
      ? [...grupo.filas].sort(
          (a, b) => (a.categoria ?? "").localeCompare(b.categoria ?? "") || a.fila - b.fila
        )
      : grupo.filas;
    for (const lote of dividirEnLotes(ordenadas, MAX_PRODUCTOS_POR_GUIA)) {
      guias.push({
        centro: grupo.centro,
        categoria: agrupar ? etiquetaCategorias(lote) : grupo.categoria,
        filas: lote,
      });
    }
  }
  return guias;
}
