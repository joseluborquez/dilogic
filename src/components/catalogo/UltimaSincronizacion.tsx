import type { UltimaSincronizacion as Ultima } from "@/lib/catalogo/sincronizar";
import { CambiosSincronizacion } from "./CambiosSincronizacion";

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

export function UltimaSincronizacion({ ultima }: { ultima: Ultima | null }) {
  if (!ultima) {
    return (
      <section className="rounded-sm border border-line bg-surface p-4 text-sm text-ink-muted">
        Todavía no hay sincronizaciones registradas.
      </section>
    );
  }

  const origen = ultima.origen === "automatica" ? "automática" : "manual";

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base font-semibold">Última sincronización</h2>
        <p className="text-sm text-ink-muted">
          {formatearFecha(ultima.iniciadaEn)} · {origen} ·{" "}
          {ultima.estado === "ok" ? (
            <span className="text-valido">completada</span>
          ) : ultima.estado === "error" ? (
            <span className="text-error">falló</span>
          ) : (
            <span>en curso</span>
          )}
        </p>
      </div>

      {ultima.estado === "error" && ultima.error && (
        <p className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">{ultima.error}</p>
      )}

      {ultima.estado === "ok" && ultima.resumen && (
        <CambiosSincronizacion
          insertados={ultima.resumen.insertados}
          bloqueados={ultima.resumen.bloqueados}
          reactivados={ultima.resumen.reactivados}
        />
      )}
    </section>
  );
}
