/** Formatos chilenos para montos y cantidades. */
const PESOS = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const NUMERO = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const ENTERO = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export const pesos = (n: number) => PESOS.format(Math.round(n));
export const numero = (n: number) => NUMERO.format(n);
export const entero = (n: number) => ENTERO.format(Math.round(n));

/** "$45,8 M" / "$812 mil": para etiquetas de grafico, donde no cabe el monto entero. */
export function pesosCorto(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${NUMERO.format(n / 1_000_000)} M`;
  if (Math.abs(n) >= 1_000) return `$${ENTERO.format(n / 1_000)} mil`;
  return pesos(n);
}

/** Variacion porcentual de `antes` a `ahora`; null si no hay base para comparar. */
export function variacion(ahora: number, antes: number): number | null {
  if (!antes) return null;
  return ((ahora - antes) / antes) * 100;
}

/** "+12%" / "−5%" / "igual". */
export function textoVariacion(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v);
  if (r === 0) return "igual";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}
