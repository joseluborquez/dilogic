"use client";

import { useState, useTransition } from "react";
import { revisarCentroAction } from "@/app/(panel)/empresas/actions";
import type { CentroPorRevisar } from "@/lib/empresas/centros";

/**
 * Contactos nuevos que la sincronización agregó a la lista oficial de centros con una decisión automática. Hugo
 * confirma cada uno: centro nuevo, juntar con uno existente, «Otros» o fuera (no cuenta). La lista la usa también el
 * buscador de productos.
 */
export function CentrosPorRevisar({ centros }: { centros: CentroPorRevisar[] }) {
  if (centros.length === 0) return null;
  return (
    <section className="vidrio-lista">
      <div className="px-4 py-3">
        <h2 className="font-display text-base font-semibold">Centros por revisar</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Contactos nuevos en las guías. Mientras no los revises, cuentan como dice «Ahora».
        </p>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {centros.map((c) => (
          <Fila key={c.id} c={c} />
        ))}
      </ul>
    </section>
  );
}

const NUEVO = "__nuevo__";
const OTROS = "__otros__";
const FUERA = "__fuera__";
const TRASPASO = "__traspaso__";

function Fila({ c }: { c: CentroPorRevisar }) {
  const inicial =
    c.tipo === "otros" ? OTROS : c.tipo === "traspaso" ? TRASPASO : c.tipo === "fuera" || c.tipo === "bins" ? FUERA : c.existentes.includes(c.centro) ? c.centro : NUEVO;
  const [opcion, setOpcion] = useState(inicial);
  const [nombre, setNombre] = useState(c.centro);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();
  const ahora =
    c.tipo === "bins" ? "Bins (no cuenta)" : c.tipo === "fuera" ? "Fuera (no cuenta)" : c.tipo === "otros" ? "Otros" : c.tipo === "traspaso" ? `${c.centro} (traspaso)` : c.centro;

  const guardar = () =>
    iniciar(async () => {
      const decision =
        opcion === OTROS
          ? { tipo: "otros" as const }
          : opcion === FUERA
            ? { tipo: "fuera" as const }
            : opcion === TRASPASO
              ? { tipo: "traspaso" as const, centro: nombre }
            : { tipo: "centro" as const, centro: opcion === NUEVO ? nombre : opcion };
      const r = await revisarCentroAction(c.id, decision);
      setMensaje(r.ok ? null : r.mensaje);
    });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-48 flex-1">
        <p className="font-medium">{c.contacto}</p>
        <p className="text-xs text-ink-muted">
          {c.empresa} · Ahora: {ahora}
        </p>
      </div>
      <select
        value={opcion}
        disabled={guardando}
        onChange={(e) => setOpcion(e.target.value)}
        className="rounded-lg border border-line bg-paper px-2 py-1 text-sm"
        aria-label={`Qué es ${c.contacto}`}
      >
        <option value={NUEVO}>Es un centro nuevo</option>
        {c.existentes.length > 0 && (
          <optgroup label="Juntar con…">
            {c.existentes.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </optgroup>
        )}
        <option value={OTROS}>Otros (cuenta como venta)</option>
        <option value={TRASPASO}>Traspaso (se factura, sin ganancia)</option>
        <option value={FUERA}>Fuera (no cuenta)</option>
      </select>
      {(opcion === NUEVO || opcion === TRASPASO) && (
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          disabled={guardando}
          className="w-40 rounded-lg border border-line bg-paper px-2 py-1 text-sm"
          aria-label="Nombre del centro"
        />
      )}
      <button type="button" onClick={guardar} disabled={guardando} className="text-teal hover:underline disabled:opacity-50">
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {mensaje && <p className="w-full text-xs text-error">{mensaje}</p>}
    </li>
  );
}
