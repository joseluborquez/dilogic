"use client";

import { useActionState, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { previsualizarPedidoAction, type EstadoPrevisualizacion } from "@/app/nueva-corrida/actions";
import type { EmpresaOpcion } from "@/lib/empresas/consultar";
import { ResultadoValidacion } from "./ResultadoValidacion";

const ESTADO_INICIAL: EstadoPrevisualizacion = { status: "inicial" };

export function NuevaCorridaForm({ empresas }: { empresas: EmpresaOpcion[] }) {
  const [estado, formAction, pending] = useActionState(previsualizarPedidoAction, ESTADO_INICIAL);
  const [empresaCodigo, setEmpresaCodigo] = useState(empresas[0]?.codigo ?? "");
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function asignarArchivo(file: File | undefined) {
    if (!file || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    inputRef.current.files = dt.files;
    setNombreArchivo(file.name);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastrando(false);
    asignarArchivo(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-5 rounded-sm border border-line bg-surface p-5">
        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-muted uppercase">Empresa</p>
          {empresas.length === 0 && (
            <p className="text-sm text-advertencia">
              No hay empresas activas.{" "}
              <Link href="/empresas" className="text-teal hover:underline">
                Agrega una empresa
              </Link>{" "}
              antes de subir un pedido.
            </p>
          )}
          <div role="radiogroup" aria-label="Empresa" className="flex flex-wrap gap-2">
            {empresas.map((empresa) => {
              const activo = empresa.codigo === empresaCodigo;
              return (
                <label
                  key={empresa.codigo}
                  className={`cursor-pointer rounded-sm border px-4 py-2 font-display text-sm font-medium transition-colors ${
                    activo
                      ? "border-teal bg-teal text-white"
                      : "border-line bg-surface text-ink hover:border-teal"
                  }`}
                >
                  <input
                    type="radio"
                    name="empresa"
                    value={empresa.codigo}
                    checked={activo}
                    onChange={() => setEmpresaCodigo(empresa.codigo)}
                    className="sr-only"
                  />
                  {empresa.nombre}
                  <span className="ml-1.5 font-mono text-xs opacity-70">{empresa.codigo}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-muted uppercase">Pedido</p>
          <label
            htmlFor="archivo"
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed px-6 py-8 text-center transition-colors ${
              arrastrando ? "border-teal bg-teal/5" : "border-line bg-paper"
            }`}
          >
            <input
              ref={inputRef}
              id="archivo"
              name="archivo"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => asignarArchivo(e.target.files?.[0])}
            />
            {nombreArchivo ? (
              <span className="font-mono text-sm">{nombreArchivo}</span>
            ) : (
              <>
                <span className="font-display text-sm font-medium">
                  Arrastra el pedido aca, o haz clic para elegirlo
                </span>
                <span className="text-xs text-ink-muted">Excel (.xlsx) o CSV, con código y cantidad</span>
              </>
            )}
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || !nombreArchivo}
            className="rounded-sm bg-teal px-5 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Validando…" : "Validar pedido"}
          </button>
        </div>
      </form>

      {estado.status === "error" && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {estado.mensaje}
        </p>
      )}

      {estado.status === "ok" && <ResultadoValidacion estado={estado} />}
    </div>
  );
}
