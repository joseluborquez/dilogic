/** Parte una lista en trozos de tamano fijo. */
export function dividirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano));
  }
  return lotes;
}

/**
 * Ejecuta `fn` sobre todos los items, pero de a `tamano` en paralelo. Un
 * `Promise.all` sobre la lista completa dispara tantas peticiones simultaneas
 * como items haya, y eso agota conexiones o choca con limites de tasa apenas
 * la lista crece.
 */
export async function enLotes<T, R>(
  items: T[],
  tamano: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const salida: R[] = [];
  for (const lote of dividirEnLotes(items, tamano)) {
    salida.push(...(await Promise.all(lote.map(fn))));
  }
  return salida;
}
