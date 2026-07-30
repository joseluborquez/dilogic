"use client";

import { useMemo, useState, useTransition } from "react";
import type { GuiaAgrupada, SolicitudAgrupada } from "@/lib/historial/consultar";
import { eliminarGuiasAction } from "@/app/historial/actions";
import { descargarZipGuias } from "./descargar-zip";

interface Props {
  solicitudes: SolicitudAgrupada[];
}

type Aviso = { tipo: "ok" | "error"; texto: string } | null;

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

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

export function HistorialSolicitudes({ solicitudes }: Props) {
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [porEliminar, setPorEliminar] = useState<string[] | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null); // clave de la accion en curso
  const [aviso, setAviso] = useState<Aviso>(null);
  const [eliminando, iniciarEliminacion] = useTransition();

  // Solo las guías emitidas tienen PDF que descargar; las que fallaron se
  // pueden seleccionar para eliminar, pero no aportan al ZIP.
  const seleccionadasConPdf = useMemo(() => {
    let n = 0;
    for (const s of solicitudes) {
      for (const g of s.guias) {
        if (seleccion.has(g.clave) && g.tienePdf) n += 1;
      }
    }
    return n;
  }, [solicitudes, seleccion]);

  function alternar(clave: string) {
    setSeleccion((previa) => {
      const siguiente = new Set(previa);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  }

  function alternarSolicitud(solicitud: SolicitudAgrupada, marcar: boolean) {
    setSeleccion((previa) => {
      const siguiente = new Set(previa);
      for (const g of solicitud.guias) {
        if (marcar) siguiente.add(g.clave);
        else siguiente.delete(g.clave);
      }
      return siguiente;
    });
  }

  async function descargar(etiqueta: string, payload: { claves?: string[]; corridaId?: string }) {
    setAviso(null);
    setDescargando(etiqueta);
    try {
      const { faltantes } = await descargarZipGuias(payload);
      setAviso(
        faltantes > 0
          ? {
              tipo: "ok",
              texto: `Descarga lista. ${plural(faltantes, "guía quedó", "guías quedaron")} sin PDF: revisa el archivo _guias-sin-pdf.txt dentro del ZIP.`,
            }
          : { tipo: "ok", texto: "Descarga lista." }
      );
    } catch (err) {
      setAviso({
        tipo: "error",
        texto: err instanceof Error ? err.message : "No se pudo armar la descarga.",
      });
    } finally {
      setDescargando(null);
    }
  }

  function confirmarEliminacion() {
    const claves = porEliminar;
    if (!claves) return;
    iniciarEliminacion(async () => {
      const resultado = await eliminarGuiasAction(claves);
      setPorEliminar(null);
      setSeleccion((previa) => {
        const siguiente = new Set(previa);
        for (const clave of claves) siguiente.delete(clave);
        return siguiente;
      });
      setAviso(
        resultado.ok
          ? {
              tipo: "ok",
              texto:
                resultado.mensaje ??
                `${plural(resultado.eliminadas, "guía eliminada", "guías eliminadas")} del historial.`,
            }
          : { tipo: "error", texto: resultado.mensaje ?? "No se pudieron eliminar las guías." }
      );
    });
  }

  if (solicitudes.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-line px-6 py-10 text-center">
        <p className="text-sm text-ink-muted">Todavía no se ha generado ninguna guía.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      {aviso && (
        <p
          role="status"
          className={`rounded-sm px-3 py-2 text-sm ${
            aviso.tipo === "ok" ? "bg-valido-bg text-valido" : "bg-error-bg text-error"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      {solicitudes.map((solicitud) => {
        const claves = solicitud.guias.map((g) => g.clave);
        const seleccionadas = claves.filter((c) => seleccion.has(c)).length;
        const todas = seleccionadas === claves.length && claves.length > 0;

        return (
          <section key={solicitud.corridaId} className="rounded-sm border border-line bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted px-3 py-2.5">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={todas}
                  ref={(el) => {
                    if (el) el.indeterminate = seleccionadas > 0 && !todas;
                  }}
                  onChange={(e) => alternarSolicitud(solicitud, e.target.checked)}
                  aria-label={`Seleccionar las ${claves.length} guías de ${solicitud.archivo}`}
                  className="mt-1 size-4 shrink-0 accent-[var(--teal)]"
                />
                <div className="min-w-0">
                  <p className="text-xs tracking-widest text-ink-muted uppercase">
                    {solicitud.empresaNombre} · {formatearFecha(solicitud.fecha)}
                  </p>
                  <h2 className="truncate font-display text-base font-semibold" title={solicitud.archivo}>
                    {solicitud.archivo}
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {plural(solicitud.totalGuias, "guía", "guías")}
                    {solicitud.totalConPdf < solicitud.totalGuias && (
                      <> · {solicitud.totalGuias - solicitud.totalConPdf} sin PDF</>
                    )}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  descargar(solicitud.corridaId, { corridaId: solicitud.corridaId })
                }
                disabled={descargando !== null || solicitud.totalConPdf === 0}
                className="shrink-0 rounded-sm border border-teal px-3 py-1.5 text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {descargando === solicitud.corridaId
                  ? "Preparando…"
                  : `Descargar las ${solicitud.totalGuias} guías (ZIP)`}
              </button>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2 font-medium">Folio</th>
                    <th className="px-3 py-2 font-medium">Centro</th>
                    <th className="px-3 py-2 font-medium">Categoría</th>
                    <th className="px-3 py-2 text-right font-medium">Productos</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 font-medium">Documento</th>
                  </tr>
                </thead>
                <tbody>
                  {solicitud.guias.map((guia) => (
                    <FilaGuia
                      key={guia.clave}
                      guia={guia}
                      corridaId={solicitud.corridaId}
                      seleccionada={seleccion.has(guia.clave)}
                      onAlternar={() => alternar(guia.clave)}
                      onEliminar={() => setPorEliminar([guia.clave])}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {seleccion.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            <p className="text-sm">
              <span className="font-display font-semibold">
                {plural(seleccion.size, "guía seleccionada", "guías seleccionadas")}
              </span>
              {seleccionadasConPdf < seleccion.size && (
                <span className="text-ink-muted"> · {seleccion.size - seleccionadasConPdf} sin PDF</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSeleccion(new Set())}
                className="px-2 py-1.5 text-sm text-ink-muted hover:underline"
              >
                Limpiar selección
              </button>
              <button
                type="button"
                onClick={() => setPorEliminar([...seleccion])}
                disabled={eliminando || descargando !== null}
                className="rounded-sm border border-error px-3 py-1.5 text-sm font-medium text-error transition-colors hover:bg-error hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Eliminar
              </button>
              <button
                type="button"
                onClick={() => descargar("seleccion", { claves: [...seleccion] })}
                disabled={descargando !== null || seleccionadasConPdf === 0}
                className="rounded-sm bg-teal px-4 py-1.5 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {descargando === "seleccion" ? "Preparando…" : "Descargar ZIP"}
              </button>
            </div>
          </div>
        </div>
      )}

      {porEliminar && (
        <ConfirmarEliminacion
          cantidad={porEliminar.length}
          eliminando={eliminando}
          onCancelar={() => setPorEliminar(null)}
          onConfirmar={confirmarEliminacion}
        />
      )}
    </div>
  );
}

/**
 * La URL firmada se pide al hacer click, no al renderizar la pagina: firmar
 * por adelantado costaba dos llamadas a Storage por guia en cada carga.
 */
function urlPdf(corridaId: string, folio: string, modo: "ver" | "descargar"): string {
  return `/api/guias/pdf?corrida=${corridaId}&folio=${encodeURIComponent(folio)}&modo=${modo}`;
}

function FilaGuia({
  guia,
  corridaId,
  seleccionada,
  onAlternar,
  onEliminar,
}: {
  guia: GuiaAgrupada;
  corridaId: string;
  seleccionada: boolean;
  onAlternar: () => void;
  onEliminar: () => void;
}) {
  return (
    <tr
      className={`border-b border-line last:border-0 ${
        seleccionada ? "bg-valido-bg/40" : "odd:bg-surface even:bg-paper"
      }`}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={seleccionada}
          onChange={onAlternar}
          aria-label={`Seleccionar guía ${guia.folio ?? "con error"}`}
          className="size-4 accent-[var(--teal)]"
        />
      </td>
      <td className="px-3 py-2 font-mono">{guia.folio ?? "—"}</td>
      <td className="px-3 py-2">{guia.centro ?? <span className="text-ink-muted">—</span>}</td>
      <td className="px-3 py-2 text-ink-muted">{guia.categoria ?? "Sin categoría"}</td>
      <td className="px-3 py-2 text-right font-mono">{guia.cantidadProductos}</td>
      <td className="px-3 py-2">
        {guia.estado === "generada" ? (
          <span className="inline-block rounded-sm border-2 border-valido bg-valido-bg px-2 py-0.5 font-display text-[11px] font-semibold tracking-wider whitespace-nowrap text-valido">
            GENERADA
          </span>
        ) : (
          <span
            className="inline-block rounded-sm border-2 border-error bg-error-bg px-2 py-0.5 font-display text-[11px] font-semibold tracking-wider whitespace-nowrap text-error"
            title={guia.mensajeError ?? undefined}
          >
            ERROR
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-3 whitespace-nowrap">
          {guia.tienePdf && guia.folio ? (
            <>
              <a
                href={urlPdf(corridaId, guia.folio, "ver")}
                target="_blank"
                rel="noreferrer"
                className="text-teal hover:underline"
              >
                Ver ↗
              </a>
              <a
                href={urlPdf(corridaId, guia.folio, "descargar")}
                className="text-teal hover:underline"
              >
                Descargar ↓
              </a>
            </>
          ) : (
            <span className="text-ink-muted">Sin PDF</span>
          )}
          <button type="button" onClick={onEliminar} className="text-error hover:underline">
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}

function ConfirmarEliminacion({
  cantidad,
  eliminando,
  onCancelar,
  onConfirmar,
}: {
  cantidad: number;
  eliminando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-6"
      onClick={onCancelar}
      onKeyDown={(e) => e.key === "Escape" && onCancelar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-eliminar"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-sm border border-line bg-surface p-5 shadow-lg"
      >
        <h2 id="titulo-eliminar" className="font-display text-lg font-semibold">
          Eliminar {plural(cantidad, "guía", "guías")} del historial
        </h2>
        <p className="mt-3 text-sm text-ink-muted">
          {cantidad === 1 ? "Esta guía dejará" : "Estas guías dejarán"} de aparecer en Dilogic. La
          guía sigue emitida en Relbase y ante el SII: para anularla hay que hacerlo en Relbase.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancelar}
            className="rounded-sm border border-line px-4 py-2 text-sm transition-colors hover:bg-surface-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={eliminando}
            className="rounded-sm bg-error px-4 py-2 font-display text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {eliminando ? "Eliminando…" : "Eliminar del historial"}
          </button>
        </div>
      </div>
    </div>
  );
}
