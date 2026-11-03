import type { TraspasoAnterior } from "@/lib/traspaso/anteriores";
import { TRASPASOS_A_MOSTRAR } from "@/lib/traspaso/anteriores";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(n));
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso));

/** Registro de lo ya traspasado: qué facturas, a qué centro y qué guías salieron (con su PDF). */
export function TraspasosAnteriores({ traspasos }: { traspasos: TraspasoAnterior[] }) {
  return (
    <section className="vidrio flex flex-col gap-3 p-5">
      <header>
        <h2 className="font-display text-lg font-semibold">Traspasos anteriores</h2>
        <p className="text-sm text-ink-muted">Los últimos {TRASPASOS_A_MOSTRAR}. También están en el Historial.</p>
      </header>
      {traspasos.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no hay traspasos.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Centro</th>
                <th className="px-3 py-2">Facturas</th>
                <th className="px-3 py-2 text-right">Neto</th>
                <th className="px-3 py-2">Guías</th>
              </tr>
            </thead>
            <tbody>
              {traspasos.map((t) => (
                <tr key={t.corridaId} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{fecha(t.fecha)}</td>
                  <td className="px-3 py-2">
                    {t.centro}
                    <span className="block text-xs text-ink-muted">{t.empresa}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{t.facturas.join(", ")}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{pesos(t.neto)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {t.guias.map((g) =>
                        g.tienePdf ? (
                          <a
                            key={g.folio}
                            href={`/api/guias/pdf?corrida=${t.corridaId}&folio=${encodeURIComponent(g.folio)}&modo=ver`}
                            target="_blank"
                            rel="noreferrer"
                            title={`Ver el PDF de la guía ${g.folio}`}
                            className="font-mono text-teal hover:underline"
                          >
                            {g.folio}
                          </a>
                        ) : (
                          <span key={g.folio} className="font-mono" title="Sin PDF guardado">
                            {g.folio}
                          </span>
                        )
                      )}
                      {t.conError > 0 && <span className="text-xs text-error">{t.conError} línea(s) con error</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
