import type { CambioEstado } from "@/lib/catalogo/sincronizar";

/**
 * Lo que una sincronizacion cambio en el catalogo. Se usa al terminar la
 * sincronizacion manual y en el resumen de la ultima (incluida la automatica).
 */
export function CambiosSincronizacion({
  insertados,
  bloqueados,
  reactivados,
}: {
  insertados: string[];
  bloqueados: CambioEstado[];
  reactivados: CambioEstado[];
}) {
  if (insertados.length === 0 && bloqueados.length === 0 && reactivados.length === 0) {
    return <p className="text-sm text-ink-muted">Sin cambios: el catálogo ya coincidía con Relbase.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {bloqueados.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
          <p className="font-medium">{bloqueados.length} código(s) bloqueado(s) según Relbase</p>
          <p>Ya no se pueden pedir. Si un pedido los trae, la validación los marcará como error.</p>
          <ul className="flex flex-col gap-0.5 text-ink">
            {bloqueados.map((b) => (
              <li key={b.sku}>
                <span className="font-mono text-xs">{b.sku}</span> {b.descripcion?.trim() ?? ""}{" "}
                <span className="text-ink-muted">— {b.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reactivados.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-valido-bg px-3 py-2 text-sm text-valido">
          <p className="font-medium">{reactivados.length} código(s) reactivado(s)</p>
          <p className="font-mono text-xs">{reactivados.map((r) => r.sku).join(", ")}</p>
        </div>
      )}

      {insertados.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-muted px-3 py-2">
          <p className="text-sm font-medium">{insertados.length} código(s) nuevo(s) agregados al catálogo</p>
          <p className="text-sm text-ink-muted">
            Estaban en Relbase y faltaban acá. Ya se pueden usar en los pedidos.
          </p>
          <p className="font-mono text-xs text-ink-muted">{insertados.join(", ")}</p>
        </div>
      )}
    </div>
  );
}
