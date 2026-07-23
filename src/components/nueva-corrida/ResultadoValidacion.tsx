import { EstadoStamp } from "@/components/ui/EstadoStamp";
import { GenerarGuiasForm } from "./GenerarGuiasForm";
import type { EstadoPrevisualizacion } from "@/app/nueva-corrida/actions";

type EstadoOk = Extract<EstadoPrevisualizacion, { status: "ok" }>;

export function ResultadoValidacion({ estado }: { estado: EstadoOk }) {
  const { empresaCodigo, empresaNombre, nombreArchivo, fuenteCatalogo, filas, erroresArchivo, resumen } =
    estado;
  const puedeGenerar = resumen.errores === 0;
  const tieneCentros = filas.some((f) => f.centro);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="font-display text-lg font-semibold">
            {empresaNombre} · {nombreArchivo}
          </p>
          <p className="text-sm text-ink-muted">
            {resumen.total} filas leidas
            {fuenteCatalogo === "local" && (
              <span className="ml-2 rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs">
                catálogo local (Supabase pendiente)
              </span>
            )}
          </p>
        </div>

        <dl className="flex gap-5 font-mono text-sm">
          <div className="text-right">
            <dt className="text-xs text-ink-muted">válidos</dt>
            <dd className="text-valido font-semibold">{resumen.validos}</dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-ink-muted">a revisar</dt>
            <dd className="text-advertencia font-semibold">{resumen.advertencias}</dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-ink-muted">errores</dt>
            <dd className="text-error font-semibold">{resumen.errores}</dd>
          </div>
        </dl>
      </div>

      {erroresArchivo.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {erroresArchivo.map((e, i) => (
            <li key={i}>{e.fila ? `Fila ${e.fila}: ` : ""}{e.mensaje}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
              <th className="px-3 py-2 font-medium">Fila</th>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 font-medium text-right">Cantidad</th>
              <th className="px-3 py-2 font-medium">Categoría</th>
              {tieneCentros && <th className="px-3 py-2 font-medium">Centro</th>}
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <tr
                key={`${fila.fila}-${fila.centro ?? ""}-${i}`}
                className="border-b border-line last:border-0 odd:bg-surface even:bg-paper"
              >
                <td className="px-3 py-2 font-mono text-ink-muted">{fila.fila}</td>
                <td className="px-3 py-2 font-mono">{fila.codigo}</td>
                <td className="px-3 py-2">
                  {fila.descripcionProducto ?? <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fila.cantidad}</td>
                <td className="px-3 py-2">{fila.categoria ?? <span className="text-ink-muted">—</span>}</td>
                {tieneCentros && (
                  <td className="px-3 py-2">{fila.centro ?? <span className="text-ink-muted">—</span>}</td>
                )}
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <EstadoStamp estado={fila.estado} />
                    {fila.mensajes.length > 0 && (
                      <span className="text-xs text-ink-muted">{fila.mensajes.join(" ")}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {puedeGenerar ? (
        <GenerarGuiasForm
          empresaCodigo={empresaCodigo}
          nombreArchivo={nombreArchivo}
          filas={filas}
        />
      ) : (
        <p className="border-t border-line pt-4 text-right text-sm text-ink-muted">
          Corrige los errores antes de generar las guías.
        </p>
      )}
    </section>
  );
}
