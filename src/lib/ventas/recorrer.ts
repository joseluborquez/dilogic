import "server-only";

import { listarGuiasPagina } from "@/lib/relbase/client";
import type { RelbaseDteResumen } from "@/lib/relbase/types";

/** Paginas que se piden a la vez. El cliente igual espacia las partidas (4,5/s). */
const PAGINAS_EN_PARALELO = 5;

/**
 * Todas las guias desde `desde` (yyyy-mm-dd), recorriendo el listado de la mas
 * nueva hacia atras en tandas de PAGINAS_EN_PARALELO. GET /dtes no filtra por
 * fecha, asi que se corta cuando una tanda ya termina antes de `desde`.
 */
export async function recorrerGuiasDesde(desde: string): Promise<RelbaseDteResumen[]> {
  const guias = new Map<number, RelbaseDteResumen>();
  let siguiente = 1;
  let totalPaginas = Infinity;
  for (;;) {
    const paginas = await Promise.all(
      Array.from({ length: PAGINAS_EN_PARALELO }, (_, i) => siguiente + i)
        .filter((p) => p <= totalPaginas)
        .map((p) => listarGuiasPagina(p))
    );
    siguiente += PAGINAS_EN_PARALELO;
    let llegoAlInicio = paginas.length === 0;
    for (const { guias: lote, totalPaginas: total } of paginas) {
      totalPaginas = total;
      // Por id: si entra una guia nueva mientras se recorre, las paginas se
      // corren y una guia puede aparecer en dos.
      for (const g of lote) if (g.start_date >= desde) guias.set(g.id, g);
      if (lote.length === 0 || lote.some((g) => g.start_date < desde)) llegoAlInicio = true;
    }
    if (llegoAlInicio || siguiente > totalPaginas) break;
  }
  return [...guias.values()];
}
