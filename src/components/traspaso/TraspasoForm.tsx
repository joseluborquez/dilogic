"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import {
  emitirTraspasoAction,
  revisarTraspasoAction,
  type EstadoEmision,
  type EstadoRevision,
} from "@/app/(panel)/traspaso/actions";
import type { EmpresaOpcion } from "@/lib/empresas/consultar";
import { descargarZipGuias } from "@/components/historial/descargar-zip";

const REVISION_INICIAL: EstadoRevision = { status: "inicial" };
const EMISION_INICIAL: EstadoEmision = { status: "inicial" };

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

function nuevaClave(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function TraspasoForm({
  empresas,
  empresaInicial,
  centroInicial,
}: {
  empresas: EmpresaOpcion[];
  empresaInicial: string;
  centroInicial: string;
}) {
  const [revision, revisar, revisando] = useActionState(revisarTraspasoAction, REVISION_INICIAL);
  const [emision, emitir, emitiendo] = useActionState(emitirTraspasoAction, EMISION_INICIAL);
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [centro, setCentro] = useState(centroInicial);
  // Huella de los archivos elegidos: la revision vale solo para esos archivos.
  const [archivos, setArchivos] = useState("");
  const [nombres, setNombres] = useState<string[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivosRevisados, setArchivosRevisados] = useState<string | null>(null);
  // Una clave por seleccion de archivos: reenviar el mismo traspaso no emite dos veces.
  const [idempotencyKey, setIdempotencyKey] = useState(nuevaClave);
  const [descargando, setDescargando] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Las acciones se lanzan a mano y no como action/formAction del <form>:
  // React 19 resetea el formulario despues de una accion de formulario, y eso
  // vaciaba el selector de archivos tras "Revisar", con lo que "Emitir" se
  // enviaba sin facturas.
  /** Deja en el input exactamente estos archivos (desde el selector o arrastrados). */
  function asignarArchivos(lista: File[]) {
    const pdfs = lista.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (inputRef.current) {
      const dt = new DataTransfer();
      pdfs.forEach((f) => dt.items.add(f));
      inputRef.current.files = dt.files;
    }
    setArchivos(pdfs.map((f) => `${f.name}:${f.size}`).join("|"));
    setNombres(pdfs.map((f) => f.name));
    setIdempotencyKey(nuevaClave());
    setAviso(
      pdfs.length < lista.length ? `Se ignoraron ${lista.length - pdfs.length} archivo(s) que no son PDF.` : null
    );
  }

  function lanzar(accion: (datos: FormData) => void) {
    if (!formRef.current) return;
    const datos = new FormData(formRef.current);
    startTransition(() => accion(datos));
  }

  const revisionVigente = revision.status === "ok" && archivosRevisados === archivos;
  const conErrores = revision.status === "ok" && revision.facturas.some((f) => f.estado === "error");
  const calculo = revision.status === "ok" ? revision.calculo : null;
  const puedeEmitir = revisionVigente && !conErrores && !!calculo && centro.trim() !== "" && !emitiendo;
  const emitido = emision.status === "listo" && emision.ok;

  return (
    <div className="flex flex-col gap-6">
      <form
        ref={formRef}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-col gap-5 vidrio p-5"
      >
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-muted uppercase">Facturas del proveedor (PDF)</p>
          <label
            htmlFor="facturas"
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              asignarArchivos([...(e.dataTransfer.files ?? [])]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
              arrastrando ? "border-teal bg-teal/5" : "border-line bg-paper"
            }`}
          >
            <input
              ref={inputRef}
              id="facturas"
              name="facturas"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={(e) => asignarArchivos([...(e.target.files ?? [])])}
            />
            {nombres.length > 0 ? (
              <>
                <span className="font-display text-sm font-medium">{nombres.length} factura(s) elegida(s)</span>
                <span className="text-xs text-ink-muted">Haz clic o arrastra otras para cambiarlas</span>
              </>
            ) : (
              <>
                <span className="font-display text-sm font-medium">
                  Arrastra las facturas aca, o haz clic para elegirlas
                </span>
                <span className="text-xs text-ink-muted">
                  PDF, varias a la vez. Se leen completas y se comparan con la compra registrada en
                  Relbase antes de generar nada.
                </span>
              </>
            )}
          </label>
          {nombres.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              {nombres.map((n) => (
                <li key={n} className="font-mono">
                  {n}
                </li>
              ))}
            </ul>
          )}
          {aviso && <p className="text-xs text-advertencia">{aviso}</p>}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="empresa" className="text-xs tracking-wide text-ink-muted uppercase">
              Empresa
            </label>
            <select
              id="empresa"
              name="empresa"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className="rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            >
              {empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="centro" className="text-xs tracking-wide text-ink-muted uppercase">
              Centro / contacto
            </label>
            <input
              id="centro"
              name="centro"
              value={centro}
              onChange={(e) => setCentro(e.target.value)}
              placeholder="Ej: PALVITAD"
              className="rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              if (!archivos) {
                setAviso("Primero elige las facturas en PDF (clic en el recuadro o arrástralas).");
                return;
              }
              setArchivosRevisados(archivos);
              lanzar(revisar);
            }}
            disabled={revisando || emitido}
            className="rounded-lg border border-teal px-5 py-2 font-display text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {revisando ? "Revisando…" : "Revisar facturas"}
          </button>
          {calculo && (
            <button
              type="button"
              onClick={() => lanzar(emitir)}
              disabled={!puedeEmitir || emitido}
              className="rounded-lg bg-teal px-5 py-2 font-display text-sm font-medium text-on-accent transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {emitiendo ? "Emitiendo…" : `Emitir ${calculo.guias.length} guía(s)`}
            </button>
          )}
        </div>
        {revision.status === "ok" && !revisionVigente && (
          <p className="text-sm text-advertencia">Cambiaste los archivos: vuelve a revisarlos.</p>
        )}
      </form>

      {revision.status === "error" && (
        <p role="alert" className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
          {revision.mensaje}
        </p>
      )}

      {revision.status === "ok" && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-base font-semibold">Facturas</h2>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
                  <th className="px-3 py-2 font-medium">Factura</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 text-right font-medium">Líneas</th>
                  <th className="px-3 py-2 text-right font-medium">Neto</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {revision.facturas.map((f) => (
                  <tr key={f.archivo} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-mono">{f.folio || "—"}</span>
                      <span className="block text-xs text-ink-muted">{f.archivo}</span>
                    </td>
                    <td className="px-3 py-2">{f.fecha ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.lineas}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.neto ? pesos(f.neto) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.total ? pesos(f.total) : "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          f.estado === "ok" ? "text-valido" : f.estado === "aviso" ? "text-advertencia" : "text-error"
                        }
                      >
                        {f.estado === "ok" ? "Lista" : f.estado === "aviso" ? "Revisar" : "No se puede usar"}
                      </span>
                      {f.mensajes.map((m) => (
                        <span key={m} className="block text-xs text-ink-muted">
                          {m}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {conErrores && (
            <p className="text-sm text-error">
              Hay facturas que no se pueden usar: quítalas de la selección y vuelve a revisar.
            </p>
          )}
        </section>
      )}

      {calculo && revisionVigente && (
        <section className="flex flex-col gap-3 vidrio p-4">
          <h2 className="font-display text-base font-semibold">Guías a emitir</h2>
          <p className="text-sm">
            {calculo.lineasFacturas} líneas de factura →{" "}
            {calculo.guias.reduce((n, g) => n + g.lineas.length, 0)} productos (los repetidos se
            suman) → <span className="font-semibold">{calculo.guias.length} guía(s)</span> con{" "}
            <span className="font-mono">PRODUCTO GENERICO</span>, contacto{" "}
            <span className="font-semibold">{centro.trim().toUpperCase() || "—"}</span>.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-md">
            <dt className="text-ink-muted">Total facturas</dt>
            <dd className="text-right font-mono">{pesos(calculo.totalFacturas)}</dd>
            <dt className="text-ink-muted">Total guías</dt>
            <dd className="text-right font-mono font-semibold">{pesos(calculo.totalGuias)}</dd>
            <dt className="text-ink-muted">Neto facturas</dt>
            <dd className="text-right font-mono">{pesos(calculo.netoFacturas)}</dd>
            <dt className="text-ink-muted">Neto guías</dt>
            <dd className="text-right font-mono">{pesos(calculo.netoGuias)}</dd>
          </dl>
          {calculo.netoGuias !== calculo.netoFacturas && (
            <p className="text-xs text-ink-muted">
              El neto de las guías es mayor porque las facturas traen impuestos específicos (carne,
              harina, bebidas): se reparten en los precios para que el total sea el mismo.
            </p>
          )}
          {calculo.guias.map((g, i) => (
            <details key={i} className="rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-sm">
                Guía {i + 1}: {g.lineas.length} productos · neto {pesos(g.neto)} · total {pesos(g.total)}
              </summary>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {g.lineas.map((l) => (
                    <tr key={l.descripcion} className="border-t border-line">
                      <td className="px-3 py-1">{l.descripcion}</td>
                      <td className="px-3 py-1 text-right font-mono">{l.cantidad.toLocaleString("es-CL")}</td>
                      <td className="px-3 py-1 text-right font-mono">{pesos(l.neto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      )}

      {emision.status === "listo" && !emision.ok && (
        <p role="alert" className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
          {emision.mensaje}
        </p>
      )}

      {emision.status === "listo" && emision.ok && (
        <section className="flex flex-col gap-2">
          <p className="font-display text-sm font-semibold">Resultado</p>
          {emision.yaExistia && (
            <p className="rounded-lg bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
              Este traspaso ya se había emitido: estas son sus guías, no se emitieron nuevas.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {emision.guias.map((g, i) => (
              <li
                key={i}
                className={`rounded-lg px-3 py-2 text-sm ${g.error ? "bg-error-bg text-error" : "bg-valido-bg text-valido"}`}
              >
                {g.error ? `Guía ${i + 1}: ${g.error}` : `Folio ${g.folio}${g.total ? ` · total ${pesos(g.total)}` : ""}`}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              disabled={descargando}
              onClick={async () => {
                setDescargando(true);
                try {
                  await descargarZipGuias({ corridaId: emision.corridaId });
                } finally {
                  setDescargando(false);
                }
              }}
              className="rounded-lg bg-teal px-4 py-2 font-display text-sm font-medium text-on-accent transition-colors hover:bg-teal-strong disabled:opacity-50"
            >
              {descargando ? "Preparando…" : "Descargar las guías (ZIP)"}
            </button>
            <Link href="/historial" className="text-sm text-teal hover:underline">
              Ver en historial →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
