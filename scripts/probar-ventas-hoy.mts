// Solo lectura: lo de hoy (Relbase) y como queda el mes en curso al juntarlo.
import { agregadoDeHoy } from "@/lib/ventas/hoy";
import { calcularAgregado, hoyChile, juntarAgregados, periodoDelMes } from "@/lib/ventas/indicadores";

const hoy = await agregadoDeHoy();
const p = periodoDelMes(hoyChile().slice(0, 7));
const base = await calcularAgregado(p.desde, p.hasta);
const mes = hoy ? juntarAgregados(base, hoy) : base;
const fila = (a: typeof base | null) => ({
  total: a?.monto ?? 0,
  guias: a?.guias ?? 0,
  ...Object.fromEntries(Object.entries(a?.porCliente ?? {}).map(([g, v]) => [g, v.monto])),
});
console.table({ sincronizado: fila(base), hoy: fila(hoy), mes: fila(mes) });
const familias = (a: typeof base) => Object.fromEntries(["AB", "CC", "FV", "AS"].map((f) => [f, a.productos.filter((x) => x.familia === f).reduce((s, x) => s + x.monto, 0)]));
console.table({ sincronizado: familias(base), mes: familias(mes) });
console.log("centros MTX:", mes.porCentro.MTX);
