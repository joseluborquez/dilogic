/**
 * Reparte las filas de un pedido en guias de despacho. Lo usan la pantalla
 * (para anunciar cuantas guias saldran) y el servidor (para emitirlas): asi lo
 * anunciado es exactamente lo emitido.
 *
 * - Separado (por defecto): una guia por centro y categoria (AB, CC, FV...),
 *   partida en lotes parejos de hasta MAX_PRODUCTOS_POR_GUIA.
 * - Agrupado: la menor cantidad posible de guias por centro. Cada categoria se
 *   parte en lotes parejos (121 AB -> 41/40/40, no 60/60/1) y las categorias
 *   chicas se juntan en una misma guia si caben (CC 32 + FV 28 = 60). Si asi
 *   saldrian mas guias que el minimo, se prueban repartos que mezclan mas.
 *
 * El PRODUCTO GENERICO no tiene categoria propia: viaja en la categoria
 * principal de su centro (abarrotes si hay, si no la que mas filas tenga),
 * para no abrir una guia solo con el.
 */
import { PRODUCTO_GENERICO } from "@/lib/catalogo/generico";

// Relbase rechaza cualquier documento electronico con mas de 60 productos.
export const MAX_PRODUCTOS_POR_GUIA = 60;

export interface FilaRepartible {
  fila: number;
  centro: string | null;
  categoria: string | null;
  codigo?: string;
}

export interface GuiaArmada<T extends FilaRepartible> {
  centro: string;
  /** Categoria de la guia; agrupada con varias, "AB+CC+FV". */
  categoria: string | null;
  filas: T[];
}

/** Lotes de tamano parejo (los mas grandes primero), cada uno de hasta `tamano`. */
function dividirParejo<T>(items: T[], tamano: number): T[][] {
  const cantidad = Math.ceil(items.length / tamano);
  const lotes: T[][] = [];
  let desde = 0;
  for (let i = 0; i < cantidad; i += 1) {
    const largo = Math.ceil((items.length - desde) / (cantidad - i));
    lotes.push(items.slice(desde, desde + largo));
    desde += largo;
  }
  return lotes;
}

function dividirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

function etiquetaCategorias<T>(filas: T[], categoriaDe: (f: T) => string | null): string | null {
  const categorias = [...new Set(filas.map(categoriaDe).filter((c): c is string => !!c))].sort();
  return categorias.length > 0 ? categorias.join("+") : null;
}

/** Junta trozos en guias de hasta MAX_PRODUCTOS_POR_GUIA: el mas grande primero, en la primera guia donde quepa. */
function empacar<T>(trozos: T[][]): T[][] {
  const guias: T[][] = [];
  for (const trozo of [...trozos].sort((a, b) => b.length - a.length)) {
    const destino = guias.find((g) => g.length + trozo.length <= MAX_PRODUCTOS_POR_GUIA);
    if (destino) destino.push(...trozo);
    else guias.push([...trozo]);
  }
  return guias;
}

/** Reparto agrupado de un centro: la minima cantidad de guias, mezclando lo menos posible. */
function repartirAgrupado<T extends FilaRepartible>(
  filas: T[],
  categoriaDe: (f: T) => string | null
): T[][] {
  const porCategoria = new Map<string, T[]>();
  for (const f of filas) {
    const c = categoriaDe(f) ?? "";
    if (!porCategoria.has(c)) porCategoria.set(c, []);
    porCategoria.get(c)!.push(f);
  }
  const categorias = [...porCategoria.keys()].sort();
  const minimo = Math.ceil(filas.length / MAX_PRODUCTOS_POR_GUIA);

  // 1) La categoria mas grande sola, en lotes parejos, y las demas juntas
  //    (Stokes: 39 AB · 38 AB · 49 CC+FV+AS, no 41 AB+AS · 60 AB+CC · 25 FV).
  const principal = [...categorias].sort((a, b) => porCategoria.get(b)!.length - porCategoria.get(a)!.length)[0];
  const separada = [
    ...dividirParejo(porCategoria.get(principal)!, MAX_PRODUCTOS_POR_GUIA),
    ...empacar(categorias.filter((c) => c !== principal).flatMap((c) => dividirParejo(porCategoria.get(c)!, MAX_PRODUCTOS_POR_GUIA))),
  ];
  if (separada.length <= minimo) return separada;
  // 2) Cada categoria en lotes parejos, y las chicas juntas donde quepan.
  const parejo = empacar(categorias.flatMap((c) => dividirParejo(porCategoria.get(c)!, MAX_PRODUCTOS_POR_GUIA)));
  if (parejo.length <= minimo) return parejo;
  // 3) Cada categoria en lotes llenos, y los restos juntos.
  const llenos = empacar(categorias.flatMap((c) => dividirEnLotes(porCategoria.get(c)!, MAX_PRODUCTOS_POR_GUIA)));
  if (llenos.length <= minimo) return llenos;
  // 4) Siempre llega al minimo: todo en fila, ordenado por categoria, en lotes parejos.
  const ordenadas = categorias.flatMap((c) => porCategoria.get(c)!);
  return dividirParejo(ordenadas, MAX_PRODUCTOS_POR_GUIA);
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
  const porCentro = new Map<string, T[]>();
  for (const fila of filas) {
    const centro = fila.centro ?? contactoManual;
    if (!porCentro.has(centro)) porCentro.set(centro, []);
    porCentro.get(centro)!.push(fila);
  }

  const guias: GuiaArmada<T>[] = [];
  for (const [centro, delCentro] of porCentro) {
    const categoriaDe = categoriaEfectiva(delCentro);

    if (agrupar) {
      for (const lote of repartirAgrupado(delCentro, categoriaDe)) {
        // Dentro de la guia, por categoria y luego en el orden del archivo.
        lote.sort((a, b) => (categoriaDe(a) ?? "").localeCompare(categoriaDe(b) ?? "") || a.fila - b.fila);
        guias.push({ centro, categoria: etiquetaCategorias(lote, categoriaDe), filas: lote });
      }
      continue;
    }

    const porCategoria = new Map<string, T[]>();
    for (const f of delCentro) {
      const c = categoriaDe(f) ?? "";
      if (!porCategoria.has(c)) porCategoria.set(c, []);
      porCategoria.get(c)!.push(f);
    }
    for (const [categoria, deLaCategoria] of porCategoria) {
      for (const lote of dividirParejo(deLaCategoria, MAX_PRODUCTOS_POR_GUIA)) {
        guias.push({ centro, categoria: categoria || null, filas: lote });
      }
    }
  }
  return guias;
}

/**
 * Categoria con que reparte cada fila de un centro: la suya, salvo el
 * PRODUCTO GENERICO, que toma la principal del centro (AB si la hay, si no la
 * mas pedida).
 */
function categoriaEfectiva<T extends FilaRepartible>(delCentro: T[]): (f: T) => string | null {
  const esGenerico = (f: T) => f.codigo === PRODUCTO_GENERICO.codigo;
  const conteo = new Map<string, number>();
  for (const f of delCentro) {
    if (esGenerico(f) || !f.categoria) continue;
    conteo.set(f.categoria, (conteo.get(f.categoria) ?? 0) + 1);
  }
  const principal = conteo.has("AB")
    ? "AB"
    : ([...conteo].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  return (f) => (esGenerico(f) && principal ? principal : f.categoria);
}
