"use client";

import { useActionState, useState } from "react";
import { generarGuiasAction, type EstadoGeneracion } from "@/app/nueva-corrida/actions-generar";
import type { FilaValidada } from "@/lib/catalogo/validar";

const ESTADO_INICIAL: EstadoGeneracion = { status: "inicial" };

interface Props {
  empresaCodigo: string;
  nombreArchivo: string;
  filas: FilaValidada[]; // solo validas/advertencia (sin errores)
}

export function GenerarGuiasForm({ empresaCodigo, nombreArchivo, filas }: Props) {
  const [estado, formAction, pending] = useActionState(generarGuiasAction, ESTADO_INICIAL);
  const [contacto, setContacto] = useState("");

  // Formato matriz: el centro ya viene por fila (columna del archivo), asi
  // que no hace falta pedirlo a mano; se genera una guia por cada uno.
  const centrosDetectados = [...new Set(filas.map((f) => f.centro).filter((c): c is string => !!c))];
  const tieneCentros = centrosDetectados.length > 0;

  const filasParaGenerar = filas.map((f) => ({
    fila: f.fila,
    codigo: f.codigo,
    cantidad: f.cantidad,
    categoria: f.categoria,
    centro: f.centro,
    productIdRelbase: f.productIdRelbase,
    precio: f.precio,
    descripcionUnidad: f.descripcionUnidad,
  }));

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      {estado.status !== "ok" && (
        <form action={formAction} className="flex flex-wrap items-end justify-end gap-3">
          <input type="hidden" name="empresa" value={empresaCodigo} />
          <input type="hidden" name="nombreArchivo" value={nombreArchivo} />
          <input type="hidden" name="filas" value={JSON.stringify(filasParaGenerar)} />

          {tieneCentros ? (
            <p className="text-sm text-ink-muted">
              Se generara una guia por centro detectado en el archivo:{" "}
              <span className="font-medium text-ink">{centrosDetectados.join(", ")}</span>
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="contacto" className="text-xs tracking-wide text-ink-muted uppercase">
                Centro de cultivo / Contacto
              </label>
              <input
                id="contacto"
                name="contacto"
                type="text"
                required
                value={contacto}
                onChange={(e) => setContacto(e.target.value)}
                placeholder="Ej: BASE CHURRECUE"
                className="rounded-sm border border-line bg-surface px-3 py-2 text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={pending || (!tieneCentros && !contacto.trim())}
            className="rounded-sm bg-teal px-5 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Generando…" : "Generar guías"}
          </button>
        </form>
      )}

      {estado.status === "error" && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {estado.mensaje}
        </p>
      )}

      {estado.status === "ok" && (
        <div className="flex flex-col gap-2">
          <p className="font-display text-sm font-semibold">Resultado de la generación</p>
          <ul className="flex flex-col gap-2">
            {estado.grupos.map((g, i) => (
              <li
                key={i}
                className={`rounded-sm px-3 py-2 text-sm ${
                  g.estado === "generada" ? "bg-valido-bg text-valido" : "bg-error-bg text-error"
                }`}
              >
                {g.centro ? `${g.centro} · ` : ""}
                {g.categoria ?? "Sin categoría"} (filas {g.filas.join(", ")}):{" "}
                {g.estado === "generada" ? `folio ${g.folio}` : g.mensajeError}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
