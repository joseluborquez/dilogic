import "server-only";

import { agregadoDeHoy } from "./hoy";
import { agregadoPeriodo, juntarAgregados, primeraFechaConVentas, type AgregadoPeriodo, type Periodo } from "./indicadores";

/**
 * Devuelve una funcion que pide el agregado de un periodo. Lo de hoy se
 * sincroniza recien manana: para el mes en curso se suma leido de Relbase
 * (lib/ventas/hoy). Si Relbase no responde, queda lo sincronizado. Los meses
 * anteriores a la primera venta cargada salen como null ("sin datos").
 */
export async function crearPedidorDeVentas(): Promise<(p: Periodo) => Promise<AgregadoPeriodo | null>> {
  const primeraFecha = await primeraFechaConVentas();
  const hayDatos = (p: Periodo) => primeraFecha != null && p.desde >= primeraFecha.slice(0, 8) + "01";
  let deHoy: Promise<AgregadoPeriodo | null> | null = null;
  return async (p: Periodo) => {
    const base = hayDatos(p) ? await agregadoPeriodo(p.desde, p.hasta) : null;
    if (!p.enCurso) return base;
    deHoy ??= agregadoDeHoy().catch(() => null);
    const hoy = await deHoy;
    if (!hoy) return base;
    return base ? juntarAgregados(base, hoy) : hoy;
  };
}
