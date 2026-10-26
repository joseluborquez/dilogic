import type { GuiaManualHistorial } from "@/lib/historial/guias-manuales";
import { GUIAS_MANUALES_A_MOSTRAR } from "@/lib/historial/guias-manuales";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(n));
const fecha = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso));

const ESTADO = {
  emitida: { texto: "Emitida", clase: "bg-valido-bg text-valido" },
  emitiendo: { texto: "Sin confirmar", clase: "bg-advertencia-bg text-advertencia" },
  error: { texto: "No se emitió", clase: "bg-error-bg text-error" },
} as const;

/** Guias emitidas desde "Guia manual": no salen de una corrida, asi que van en su propia lista. */
export function GuiasManualesHistorial({ guias }: { guias: GuiaManualHistorial[] }) {
  return (
    <section className="vidrio flex flex-col gap-3 p-5">
      <header>
        <h2 className="font-display text-lg font-semibold">Guías manuales</h2>
        <p className="text-sm text-ink-muted">
          Emitidas desde Guía manual. Se muestran las últimas {GUIAS_MANUALES_A_MOSTRAR}.
        </p>
      </header>
      {guias.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay guías manuales con estos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Neto</th>
                <th className="px-3 py-2">Emitió</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {guias.map((g) => (
                <tr key={g.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{fecha(g.fecha)}</td>
                  <td className="px-3 py-2 font-mono">{g.folio ?? "—"}</td>
                  <td className="px-3 py-2">{g.cliente ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{pesos(g.neto)}</td>
                  <td className="px-3 py-2 text-ink-muted">{g.usuario ?? "—"}</td>
                  <td className="px-3 py-2" title={g.error ?? undefined}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[g.estado].clase}`}>{ESTADO[g.estado].texto}</span>
                  </td>
                  <td className="px-3 py-2">
                    {g.estado === "emitida" && g.dteId != null && (
                      <a href={`/api/guias-manuales/pdf?id=${g.id}`} target="_blank" rel="noreferrer" className="text-teal hover:underline">
                        PDF
                      </a>
                    )}
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
