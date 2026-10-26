"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  finalizarSincronizacionAction,
  iniciarSincronizacionAction,
  registrarErrorSincronizacionAction,
  sincronizarLoteAction,
  sincronizarPendientesAction,
} from "@/app/(panel)/catalogo/actions";
import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";
import type {
  CodigoCambiado,
  ResultadoEstado,
  ResumenSincronizacion,
} from "@/lib/catalogo/sincronizar";
import { CambiosSincronizacion } from "./CambiosSincronizacion";

interface Progreso {
  id: string;
  inicio: string;
  siguientePagina: number;
  actualizados: number;
  insertados: string[];
  codigosCambiados: CodigoCambiado[];
}

type Estado =
  | { fase: "inicial" }
  | { fase: "sincronizando"; paginaActual: number; totalPages: number; actualizados: number }
  | { fase: "buscando_pendientes" }
  | { fase: "aplicando" }
  | { fase: "error"; mensaje: string; progreso: Progreso | null }
  | {
      fase: "ok";
      resumen: ResumenSincronizacion;
      actualizados: number;
      insertados: string[];
      estado: ResultadoEstado;
    };

export function SincronizarCatalogoForm() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: "inicial" });

  async function sincronizarLoteConReintentos(page: number) {
    const INTENTOS = 3;
    for (let intento = 1; intento <= INTENTOS; intento++) {
      try {
        return await sincronizarLoteAction(page);
      } catch (err) {
        if (intento === INTENTOS) throw err;
        // Falla transitoria de red hacia Relbase (ej. connect timeout):
        // reintentar antes de rendirse, el progreso previo ya quedo guardado.
        await new Promise((r) => setTimeout(r, 1500 * intento));
      }
    }
    throw new Error("No se pudo completar el lote tras reintentos.");
  }

  /**
   * Sin `previo` empieza una sincronizacion nueva; con `previo` la reanuda
   * conservando su inicio, que es lo que define que codigos se "vieron".
   */
  async function sincronizar(previo: Progreso | null = null) {
    let progreso: Progreso | null = previo;
    try {
      if (!progreso) {
        const { id, inicio } = await iniciarSincronizacionAction();
        progreso = { id, inicio, siguientePagina: 1, actualizados: 0, insertados: [], codigosCambiados: [] };
      }

      let totalPages = progreso.siguientePagina;
      do {
        const resultado = await sincronizarLoteConReintentos(progreso.siguientePagina);
        totalPages = resultado.totalPages;
        progreso = {
          ...progreso,
          siguientePagina: resultado.hastaPagina + 1,
          actualizados: progreso.actualizados + resultado.actualizados,
          insertados: [...progreso.insertados, ...resultado.insertados],
          codigosCambiados: [...progreso.codigosCambiados, ...resultado.codigosCambiados],
        };
        setEstado({
          fase: "sincronizando",
          paginaActual: resultado.hastaPagina,
          totalPages,
          actualizados: progreso.actualizados,
        });
      } while (progreso.siguientePagina <= totalPages);

      // Los pendientes (sin producto, o que el listado no mostro) se buscan
      // por codigo de a lotes, recorriendo el catalogo hasta el final.
      setEstado({ fase: "buscando_pendientes" });
      let resumen = await sincronizarPendientesAction(0, progreso.inicio);
      while (resumen.quedanMas) {
        resumen = await sincronizarPendientesAction(resumen.siguienteIndice, progreso.inicio);
      }

      setEstado({ fase: "aplicando" });
      const resultadoEstado = await finalizarSincronizacionAction(progreso.id, progreso.inicio, {
        actualizados: progreso.actualizados,
        insertados: progreso.insertados,
        codigosCambiados: progreso.codigosCambiados,
      });
      setEstado({
        fase: "ok",
        resumen,
        actualizados: progreso.actualizados,
        insertados: [...progreso.insertados].sort(),
        estado: resultadoEstado,
      });
      // Refresca "Ultima sincronizacion" en la pagina.
      router.refresh();
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : "Error desconocido durante la sincronizacion.";
      if (progreso) await registrarErrorSincronizacionAction(progreso.id, mensaje).catch(() => undefined);
      setEstado({ fase: "error", mensaje, progreso });
    }
  }

  const enCurso =
    estado.fase === "sincronizando" || estado.fase === "buscando_pendientes" || estado.fase === "aplicando";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => sincronizar()}
          disabled={enCurso}
          className="rounded-lg bg-teal px-5 py-2 font-display text-sm font-medium text-on-accent transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enCurso ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
        <p className="text-sm text-ink-muted">
          Solo lectura hacia Relbase, en lotes de {PAGINAS_POR_LOTE} páginas para no exceder el
          tiempo máximo de una función en Vercel.
        </p>
      </div>

      {estado.fase === "sincronizando" && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full bg-teal transition-all"
              style={{ width: `${Math.min(100, (estado.paginaActual / estado.totalPages) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-ink-muted">
            página {estado.paginaActual} / {estado.totalPages} · {estado.actualizados} productos
            actualizados
          </p>
        </div>
      )}

      {estado.fase === "buscando_pendientes" && (
        <p className="text-sm text-ink-muted">Buscando por código los que el listado no mostró…</p>
      )}

      {estado.fase === "aplicando" && (
        <p className="text-sm text-ink-muted">Aplicando lo que dice Relbase al catálogo…</p>
      )}

      {estado.fase === "error" && (
        <div className="flex flex-col gap-2 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
          <p role="alert">{estado.mensaje}</p>
          {estado.progreso && estado.progreso.siguientePagina > 1 && (
            <div>
              <button
                type="button"
                onClick={() => sincronizar(estado.progreso)}
                className="rounded-lg border border-error px-3 py-1 text-xs font-medium hover:bg-error hover:text-on-accent"
              >
                Reanudar desde la página {estado.progreso.siguientePagina}
              </button>
            </div>
          )}
        </div>
      )}

      {estado.fase === "ok" && (
        <div className="flex flex-col gap-3 vidrio p-4">
          <p className="text-sm text-ink-muted">{estado.actualizados} productos actualizados en total.</p>

          <CambiosSincronizacion
            insertados={estado.insertados}
            bloqueados={estado.estado.bloqueados}
            reactivados={estado.estado.reactivados}
          />

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium text-right">Total SKUs</th>
                  <th className="px-3 py-2 font-medium text-right">Con match</th>
                  <th className="px-3 py-2 font-medium">Sin match</th>
                </tr>
              </thead>
              <tbody>
                {estado.resumen.porEmpresa.map((e) => (
                  <tr key={e.codigoInterno} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-mono">{e.codigoInterno}</td>
                    <td className="px-3 py-2 text-right font-mono">{e.total}</td>
                    <td className="px-3 py-2 text-right font-mono text-valido">{e.conMatch}</td>
                    <td className="px-3 py-2">
                      {e.sinMatch.length === 0 ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <span className="text-error">{e.sinMatch.join(", ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
