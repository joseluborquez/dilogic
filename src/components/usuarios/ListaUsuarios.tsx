"use client";

import { useState, useTransition } from "react";
import {
  cambiarEstadoUsuarioAction,
  cambiarRolUsuarioAction,
} from "@/app/usuarios/actions";
import type { ResumenUsuario } from "@/lib/auth/usuarios";

function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const ESTADOS: Record<ResumenUsuario["estado"], string> = {
  activo: "border-valido bg-valido-bg text-valido",
  pendiente: "border-advertencia bg-advertencia-bg text-advertencia",
  bloqueado: "border-error bg-error-bg text-error",
};

export function ListaUsuarios({
  usuarios,
  yoId,
}: {
  usuarios: ResumenUsuario[];
  yoId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [trabajando, iniciar] = useTransition();

  function ejecutar(accion: () => Promise<{ ok: boolean; mensaje?: string }>) {
    setError(null);
    iniciar(async () => {
      const resultado = await accion();
      if (!resultado.ok) setError(resultado.mensaje ?? "No se pudo completar la acción.");
    });
  }

  const pendientes = usuarios.filter((u) => u.estado === "pendiente");

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {pendientes.length > 0 && (
        <p className="rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
          {pendientes.length === 1
            ? "Hay 1 cuenta esperando aprobación."
            : `Hay ${pendientes.length} cuentas esperando aprobación.`}{" "}
          Nadie puede emitir guías hasta que la actives.
        </p>
      )}

      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
              <th className="px-3 py-2 font-medium">Usuario</th>
              <th className="px-3 py-2 font-medium">Rol</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Solicitudes</th>
              <th className="px-3 py-2 text-right font-medium">Guías</th>
              <th className="px-3 py-2 font-medium">Última</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0 odd:bg-surface even:bg-paper">
                <td className="px-3 py-2">
                  <span className="block font-medium">{u.nombre ?? "—"}</span>
                  <span className="block text-xs text-ink-muted">{u.email}</span>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.rol}
                    disabled={trabajando}
                    onChange={(e) =>
                      ejecutar(() =>
                        cambiarRolUsuarioAction(u.id, e.target.value as "admin" | "operador")
                      )
                    }
                    className="rounded-sm border border-line bg-paper px-2 py-1 text-sm"
                  >
                    <option value="operador">Operador</option>
                    <option value="admin">Administrador</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-sm border-2 px-2 py-0.5 font-display text-[11px] font-semibold tracking-wider uppercase ${ESTADOS[u.estado]}`}
                  >
                    {u.estado}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{u.solicitudes}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {u.guias}
                  {u.guiasConError > 0 && (
                    <span className="ml-1 text-xs text-error">+{u.guiasConError} con error</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">{formatearFecha(u.ultimaActividad)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-3 whitespace-nowrap">
                    {u.estado !== "activo" && (
                      <button
                        type="button"
                        disabled={trabajando}
                        onClick={() => ejecutar(() => cambiarEstadoUsuarioAction(u.id, "activo"))}
                        className="text-teal hover:underline disabled:opacity-50"
                      >
                        Activar
                      </button>
                    )}
                    {u.estado === "activo" && u.id !== yoId && (
                      <button
                        type="button"
                        disabled={trabajando}
                        onClick={() =>
                          ejecutar(() => cambiarEstadoUsuarioAction(u.id, "bloqueado"))
                        }
                        className="text-error hover:underline disabled:opacity-50"
                      >
                        Bloquear
                      </button>
                    )}
                    {u.id === yoId && <span className="text-xs text-ink-muted">tú</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
