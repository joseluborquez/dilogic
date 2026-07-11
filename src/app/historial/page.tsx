import Link from "next/link";
import { obtenerHistorial } from "@/lib/historial/consultar";

// Depende de datos en vivo (guias generadas + URLs firmadas con expiracion
// corta): no debe quedar cacheado como pagina estatica.
export const dynamic = "force-dynamic";

function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function HistorialPage() {
  const empresas = await obtenerHistorial();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Historial de guías</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Guías generadas, agrupadas por empresa y categoría. El PDF se descarga directo desde
            aquí, sin entrar a Relbase.
          </p>
        </div>
        <Link href="/nueva-corrida" className="shrink-0 text-sm text-teal hover:underline">
          ← Nueva corrida
        </Link>
      </header>

      {empresas.length === 0 && (
        <p className="text-sm text-ink-muted">Todavía no se ha generado ninguna guía.</p>
      )}

      {empresas.map((empresa) => (
        <section key={empresa.empresaCodigo} className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-semibold">
            {empresa.empresaNombre} <span className="font-mono text-sm text-ink-muted">{empresa.empresaCodigo}</span>
          </h2>

          <div className="flex flex-col gap-4">
            {empresa.categorias.map((cat) => (
              <div key={cat.categoria ?? "sin-categoria"} className="rounded-sm border border-line">
                <div className="border-b border-line bg-surface-muted px-3 py-2 text-xs tracking-wide text-ink-muted uppercase">
                  {cat.categoria ?? "Sin categoría"}
                </div>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
                      <th className="px-3 py-2 font-medium">Folio</th>
                      <th className="px-3 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium text-right">Productos</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      <th className="px-3 py-2 font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.guias.map((guia, i) => (
                      <tr key={i} className="border-b border-line last:border-0 odd:bg-surface even:bg-paper">
                        <td className="px-3 py-2 font-mono">{guia.folio ?? "—"}</td>
                        <td className="px-3 py-2 text-ink-muted">{formatearFecha(guia.fecha)}</td>
                        <td className="px-3 py-2 text-right font-mono">{guia.cantidadProductos}</td>
                        <td className="px-3 py-2">
                          {guia.estado === "generada" ? (
                            <span className="rounded-sm border-2 border-valido bg-valido-bg px-2 py-0.5 text-[11px] font-semibold tracking-wider text-valido">
                              GENERADA
                            </span>
                          ) : (
                            <span
                              className="rounded-sm border-2 border-error bg-error-bg px-2 py-0.5 text-[11px] font-semibold tracking-wider text-error"
                              title={guia.mensajeError ?? undefined}
                            >
                              ERROR
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {guia.pdfUrl ? (
                            <a
                              href={guia.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-teal hover:underline"
                            >
                              Ver PDF ↗
                            </a>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
