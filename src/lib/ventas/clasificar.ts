/**
 * Empresa y familia de un producto segun su codigo de Relbase:
 * - CERQ_AB_002 -> empresa CERQ, familia AB (formato actual de Dilogic).
 * - MTX_001, YDR_243 -> empresa por el prefijo; familia segun
 *   familias-antiguas.json (codigos usados hasta jun/jul-2026).
 * - O-PG-166053 -> el PRODUCTO GENERICO, que se cuenta aparte.
 * - Cualquier otro (AMS_245, A-AD-816643...) -> OTROS.
 */
import familiasAntiguas from "./familias-antiguas.json";

export const EMPRESAS_CONOCIDAS = ["CERQ", "YDR", "MTX"] as const;
export type EmpresaVenta = (typeof EMPRESAS_CONOCIDAS)[number] | "GENERICO" | "OTROS";

export const CODIGO_GENERICO = "O-PG-166053";

/**
 * product_id de Relbase -> familia, para los codigos antiguos sin familia en el
 * codigo. Armada el 25-oct-2026 con los 702 productos antiguos vendidos desde
 * abril: primero por nombre contra el catalogo nuevo de la misma empresa (576)
 * y si no, por la categoria de Relbase (126; los congelados siempre CC).
 */
const FAMILIA_ANTIGUA: Record<string, string | null> = familiasAntiguas;

export function clasificarCodigo(
  codigo: string | null,
  productId?: number | null
): { empresa: EmpresaVenta; familia: string | null } {
  const c = (codigo ?? "").trim().toUpperCase();
  if (c === CODIGO_GENERICO) return { empresa: "GENERICO", familia: null };
  const actual = /^(CERQ|YDR|MTX)_([A-Z]+)_\d+$/.exec(c);
  if (actual) return { empresa: actual[1] as EmpresaVenta, familia: actual[2] };
  const antiguo = /^(CERQ|YDR|MTX)[_-]/.exec(c);
  if (antiguo) {
    return { empresa: antiguo[1] as EmpresaVenta, familia: FAMILIA_ANTIGUA[String(productId)] ?? null };
  }
  return { empresa: "OTROS", familia: null };
}
