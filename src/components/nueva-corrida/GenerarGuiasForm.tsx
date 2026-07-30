"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { generarGuiasAction, type EstadoGeneracion } from "@/app/nueva-corrida/actions-generar";
import type { FilaValidada } from "@/lib/catalogo/validar";
import { descargarZipGuias } from "@/components/historial/descargar-zip";

const ESTADO_INICIAL: EstadoGeneracion = { status: "inicial" };

interface Props {
  empresaCodigo: string;
  nombreArchivo: string;
  filas: FilaValidada[]; // solo validas/advertencia (sin errores)
  /** Llave de esta validacion: evita emitir dos veces el mismo pedido. */
  idempotencyKey: string;
}

export function GenerarGuiasForm({
  empresaCodigo,
  nombreArchivo,
  filas,
  idempotencyKey,
}: Props) {
  const [estado, formAction, pending] = useActionState(generarGuiasAction, ESTADO_INICIAL);
  const [contacto, setContacto] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [avisoDescarga, setAvisoDescarga] = useState<string | null>(null);

  // Recien generada la partida es cuando Hugo necesita los documentos: se
  // descargan aqui mismo, sin pasar por el historial.
  async function descargarTodas(corridaId: string) {
    setAvisoDescarga(null);
    setDescargando(true);
    try {
      const { faltantes, archivos } = await descargarZipGuias({ corridaId });
      const partes = archivos > 1 ? `Por el tamaño, se descargó en ${archivos} archivos. ` : "";
      if (faltantes > 0 || archivos > 1) {
        setAvisoDescarga(
          `${partes}${
            faltantes > 0
              ? `${faltantes} guía(s) quedaron sin PDF: revisa el archivo _guias-sin-pdf.txt.`
              : ""
          }`.trim()
        );
      }
    } catch (err) {
      setAvisoDescarga(err instanceof Error ? err.message : "No se pudo armar la descarga.");
    } finally {
      setDescargando(false);
    }
  }

  // Formato matriz: el centro ya viene por fila (columna del archivo), asi
  // que no hace falta pedirlo a mano; se genera una guia por cada uno.
  const centrosDetectados = [...new Set(filas.map((f) => f.centro).filter((c): c is string => !!c))];
  const tieneCentros = centrosDetectados.length > 0;

  // Solo el pedido: el producto de Relbase, el precio y la categoria los
  // resuelve el servidor contra el catalogo (son el contenido de un DTE, no
  // pueden depender de lo que viaje por el navegador).
  const filasParaGenerar = filas.map((f) => ({
    fila: f.fila,
    codigo: f.codigo,
    cantidad: f.cantidad,
    centro: f.centro,
  }));

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      {estado.status !== "ok" && (
        <form action={formAction} className="flex flex-wrap items-end justify-end gap-3">
          <input type="hidden" name="empresa" value={empresaCodigo} />
          <input type="hidden" name="nombreArchivo" value={nombreArchivo} />
          <input type="hidden" name="filas" value={JSON.stringify(filasParaGenerar)} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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
          {estado.yaExistia && (
            <p className="rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
              Este pedido ya se había generado. Estas son las guías de esa vez: no se emitieron
              nuevas.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {estado.grupos.map((g, i) => (
              <li
                key={i}
                className={`rounded-sm px-3 py-2 text-sm ${
                  g.estado === "generada" ? "bg-valido-bg text-valido" : "bg-error-bg text-error"
                }`}
              >
                {g.centro ? `${g.centro} · ` : ""}
                {g.categoria ?? "Sin categoría"}
                {/* Al recuperar una corrida ya generada no se reconstruyen las
                    filas del archivo original, solo las guias que quedaron. */}
                {g.filas.length > 0 && ` (filas ${g.filas.join(", ")})`}:{" "}
                {g.estado === "generada" ? `folio ${g.folio}` : g.mensajeError}
              </li>
            ))}
          </ul>

          {estado.grupos.some((g) => g.estado === "generada") && (
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => descargarTodas(estado.corridaId)}
                disabled={descargando}
                className="rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {descargando ? "Preparando…" : "Descargar todas las guías (ZIP)"}
              </button>
              <Link href="/historial" className="text-sm text-teal hover:underline">
                Ver en historial →
              </Link>
            </div>
          )}

          {avisoDescarga && (
            <p role="status" className="rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
              {avisoDescarga}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
