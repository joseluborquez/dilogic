/**
 * PRODUCTO GENERICO de Relbase: un producto comodin para lo que no esta en el
 * catalogo de ninguna empresa (ej. los "productos externos" que Multi-X pide
 * al final de su planilla). Viaja con una descripcion propia (lo que se
 * despacha de verdad) y un precio puesto a mano. Sin dependencias de
 * servidor: lo usan la pantalla y el servidor.
 */
export const PRODUCTO_GENERICO = {
  productId: 8134289,
  codigo: "O-PG-166053",
  nombre: "PRODUCTO GENERICO",
} as const;

/**
 * Categoria del generico en la revision. Al repartir en guias toma la
 * principal de su centro (ver lib/guias/armar.ts).
 */
export const CATEGORIA_GENERICO = "AB";

const ALIAS_CODIGO_GENERICO = new Set(["o-pg-166053", "generico", "producto generico"]);

/** true si el codigo de un pedido pide el producto generico ("GENERICO", "O-PG-166053"...). */
export function esCodigoGenerico(codigo: string): boolean {
  const normal = codigo
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
  return ALIAS_CODIGO_GENERICO.has(normal);
}
