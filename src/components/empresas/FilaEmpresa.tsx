"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  actualizarEmpresaAction,
  alternarActivoEmpresaAction,
  type EstadoEmpresa,
} from "@/app/empresas/actions";
import type { EmpresaDetalle } from "@/lib/empresas/consultar";

const ESTADO_INICIAL: EstadoEmpresa = { status: "inicial" };

export function FilaEmpresa({ empresa }: { empresa: EmpresaDetalle }) {
  const [estado, formAction, guardando] = useActionState(actualizarEmpresaAction, ESTADO_INICIAL);
  const [editando, setEditando] = useState(false);
  const [cambiandoEstado, iniciarCambio] = useTransition();

  const listaParaGenerar =
    empresa.relbaseCustomerId != null &&
    empresa.relbaseWareHouseId != null &&
    empresa.tieneCredenciales &&
    empresa.totalSkus > 0 &&
    empresa.skusSinProductId === 0;

  return (
    <li className="rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-semibold">{empresa.nombre}</h2>
            <span className="font-mono text-xs text-ink-muted">{empresa.codigo}</span>
            {!empresa.activo && (
              <span className="rounded-sm border border-line px-2 py-0.5 text-[11px] tracking-wider text-ink-muted uppercase">
                Inactiva
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {empresa.totalSkus > 0
              ? `${empresa.totalSkus} códigos`
              : "Sin catálogo cargado"}
            {empresa.skusSinProductId > 0 && (
              <> · {empresa.skusSinProductId} sin sincronizar con Relbase</>
            )}
            {empresa.dispatchAddress && <> · {empresa.dispatchAddress}</>}
          </p>
          {!listaParaGenerar && empresa.activo && (
            <p className="mt-1 text-sm text-advertencia">
              {empresa.totalSkus === 0
                ? "Falta cargar el catálogo de códigos."
                : empresa.skusSinProductId > 0
                  ? "Falta sincronizar el catálogo con Relbase para obtener precios e IDs."
                  : "Faltan datos de destino (cliente o bodega) para poder generar guías."}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-sm">
          {empresa.skusSinProductId > 0 && (
            <Link href="/catalogo" className="text-teal hover:underline">
              Sincronizar →
            </Link>
          )}
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className="text-teal hover:underline"
          >
            {editando ? "Cerrar" : "Editar"}
          </button>
          <button
            type="button"
            disabled={cambiandoEstado}
            onClick={() =>
              iniciarCambio(async () => {
                await alternarActivoEmpresaAction(empresa.id, !empresa.activo);
              })
            }
            className="text-ink-muted hover:underline disabled:opacity-50"
          >
            {empresa.activo ? "Desactivar" : "Activar"}
          </button>
        </div>
      </div>

      {editando && (
        <form action={formAction} className="flex flex-col gap-4 border-t border-line px-4 py-4">
          <input type="hidden" name="id" value={empresa.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs tracking-wide text-ink-muted uppercase">Nombre</label>
              <input
                name="nombre"
                defaultValue={empresa.nombre}
                required
                className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs tracking-wide text-ink-muted uppercase">
                Dirección de despacho
              </label>
              <input
                name="direccion"
                defaultValue={empresa.dispatchAddress ?? ""}
                className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs tracking-wide text-ink-muted uppercase">
                ID de cliente Relbase
              </label>
              <input
                name="customerId"
                inputMode="numeric"
                defaultValue={empresa.relbaseCustomerId ?? ""}
                className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs tracking-wide text-ink-muted uppercase">Bodega</label>
              <input
                name="wareHouseId"
                inputMode="numeric"
                defaultValue={empresa.relbaseWareHouseId ?? ""}
                className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs tracking-wide text-ink-muted uppercase">ID de ciudad</label>
              <input
                name="cityId"
                inputMode="numeric"
                defaultValue={empresa.dispatchCityId ?? ""}
                className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs tracking-wide text-ink-muted uppercase">ID de comuna</label>
              <input
                name="communeId"
                inputMode="numeric"
                defaultValue={empresa.dispatchCommuneId ?? ""}
                className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          {estado.status === "error" && (
            <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
              {estado.mensaje}
            </p>
          )}
          {estado.status === "ok" && (
            <p className="rounded-sm bg-valido-bg px-3 py-2 text-sm text-valido">{estado.mensaje}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={guardando}
              className="rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
