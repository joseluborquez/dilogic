"use client";

import { useState } from "react";
import {
  desactivarCodigoAction,
  sincronizarLoteAction,
  sincronizarPendientesAction,
} from "@/app/catalogo/actions";
import { PAGINAS_POR_LOTE } from "@/lib/catalogo/constantes";
import type { CodigoCambiado, ResumenSincronizacion } from "@/lib/catalogo/sincronizar";

type Estado =
  | { fase: "inicial" }
  | { fase: "sincronizando"; paginaActual: number; totalPages: number; actualizados: number }
  | { fase: "buscando_pendientes" }
  | {
      fase: "error";
      mensaje: string;
      reanudarDesde: number;
      actualizadosHastaAhora: number;
      insertadosHastaAhora: string[];
      cambiadosHastaAhora: CodigoCambiado[];
    }
  | {
      fase: "ok";
      resumen: ResumenSincronizacion;
      actualizados: number;
      insertados: string[];
      cambiados: CodigoCambiado[];
    };

export function SincronizarCatalogoForm() {
  const [estado, setEstado] = useState<Estado>({ fase: "inicial" });
  // Por SKU: "…" mientras se desactiva, "Desactivado" o el mensaje de error.
  const [desactivados, setDesactivados] = useState<Record<string, string>>({});

  async function desactivar(sku: string) {
    setDesactivados((d) => ({ ...d, [sku]: "…" }));
    const res = await desactivarCodigoAction(sku);
    setDesactivados((d) => ({ ...d, [sku]: res.ok ? "Desactivado" : res.mensaje }));
  }

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

  async function iniciarSincronizacion(
    desdePagina = 1,
    actualizadosPrevios = 0,
    insertadosPrevios: string[] = [],
    cambiadosPrevios: CodigoCambiado[] = []
  ) {
    let page = desdePagina;
    let totalPages = 1;
    let actualizados = actualizadosPrevios;
    const insertados = [...insertadosPrevios];
    const cambiados = [...cambiadosPrevios];

    try {
      do {
        const resultado = await sincronizarLoteConReintentos(page);
        totalPages = resultado.totalPages;
        actualizados += resultado.actualizados;
        insertados.push(...resultado.insertados);
        cambiados.push(...resultado.codigosCambiados);
        page = resultado.hastaPagina + 1;
        setEstado({ fase: "sincronizando", paginaActual: resultado.hastaPagina, totalPages, actualizados });
      } while (page <= totalPages);

      // Los pendientes se resuelven de a lotes (cada uno es una consulta a
      // Relbase por SKU): se repite recorriendo el catalogo hasta el final.
      setEstado({ fase: "buscando_pendientes" });
      let resumen = await sincronizarPendientesAction();
      while (resumen.quedanMas) {
        resumen = await sincronizarPendientesAction(resumen.siguienteIndice);
      }
      setEstado({
        fase: "ok",
        resumen,
        actualizados,
        insertados: insertados.sort(),
        cambiados: cambiados.sort((a, b) => a.sku.localeCompare(b.sku)),
      });
    } catch (err) {
      setEstado({
        fase: "error",
        mensaje: err instanceof Error ? err.message : "Error desconocido durante la sincronizacion.",
        reanudarDesde: page,
        actualizadosHastaAhora: actualizados,
        insertadosHastaAhora: insertados,
        cambiadosHastaAhora: cambiados,
      });
    }
  }

  const enCurso = estado.fase === "sincronizando" || estado.fase === "buscando_pendientes";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => iniciarSincronizacion()}
          disabled={enCurso}
          className="rounded-sm bg-teal px-5 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enCurso ? "Sincronizando…" : "Sincronizar catálogo con Relbase"}
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
        <p className="text-sm text-ink-muted">Buscando los SKUs pendientes por código directo…</p>
      )}

      {estado.fase === "error" && (
        <div className="flex flex-col gap-2 rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          <p role="alert">{estado.mensaje}</p>
          <div>
            <button
              type="button"
              onClick={() =>
                iniciarSincronizacion(
                  estado.reanudarDesde,
                  estado.actualizadosHastaAhora,
                  estado.insertadosHastaAhora,
                  estado.cambiadosHastaAhora
                )
              }
              className="rounded-sm border border-error px-3 py-1 text-xs font-medium hover:bg-error hover:text-white"
            >
              Reanudar desde la página {estado.reanudarDesde}
            </button>
          </div>
        </div>
      )}

      {estado.fase === "ok" && (
        <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-4">
          <p className="text-sm text-ink-muted">{estado.actualizados} productos actualizados en total.</p>

          {estado.insertados.length > 0 && (
            <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface-muted px-3 py-2">
              <p className="text-sm font-medium">
                {estado.insertados.length} código(s) nuevo(s) agregados al catálogo
              </p>
              <p className="text-sm text-ink-muted">
                Estaban en Relbase y faltaban acá. Ya se pueden usar en los pedidos.
              </p>
              <p className="font-mono text-xs text-ink-muted">{estado.insertados.join(", ")}</p>
            </div>
          )}

          {estado.cambiados.length > 0 && (
            <div className="flex flex-col gap-2 rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
              <p className="font-medium">
                {estado.cambiados.length} código(s) del catálogo cambiaron en Relbase
              </p>
              <p>
                Alguien le cambió el código al producto en Relbase. Las guías con el código de la
                izquierda salen con el producto de la derecha: revisa que sea el mismo. Si no lo es,
                desactiva el código del catálogo.
              </p>
              <ul className="flex flex-col gap-1">
                {estado.cambiados.map((c) => (
                  <li key={c.sku} className="flex flex-wrap items-center justify-between gap-2 text-ink">
                    <span>
                      <span className="font-mono text-xs">{c.sku}</span> {c.descripcion ?? ""}{" "}
                      <span className="text-ink-muted">→</span>{" "}
                      <span className="font-mono text-xs">{c.codigoRelbase ?? "(sin código)"}</span>{" "}
                      {c.nombreRelbase ?? ""}
                    </span>
                    {desactivados[c.sku] ? (
                      <span className="text-xs text-ink-muted">{desactivados[c.sku]}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => desactivar(c.sku)}
                        className="rounded-sm border border-advertencia px-2 py-0.5 text-xs font-medium text-advertencia hover:bg-advertencia hover:text-white"
                      >
                        Desactivar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded-sm border border-line">
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
