"use client";

import { useState, useTransition } from "react";
import { buscarClienteRelbaseAction } from "@/app/empresas/actions";
import type { OpcionReferencia } from "@/lib/empresas/referencias";

interface Props {
  onElegir: (cliente: OpcionReferencia) => void;
  elegido: OpcionReferencia | null;
}

/**
 * Busca el cliente en Relbase (solo lectura) para no tener que averiguar el
 * customer_id a mano. Al elegirlo se rellenan tambien direccion, ciudad y
 * comuna cuando Relbase las entrega.
 */
export function BuscadorClienteRelbase({ onElegir, elegido }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<OpcionReferencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, iniciarBusqueda] = useTransition();

  function buscar() {
    setError(null);
    iniciarBusqueda(async () => {
      const respuesta = await buscarClienteRelbaseAction(texto);
      if (respuesta.ok) {
        setResultados(respuesta.clientes);
      } else {
        setResultados(null);
        setError(respuesta.mensaje);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="buscar-cliente" className="text-xs tracking-wide text-ink-muted uppercase">
        Cliente en Relbase
      </label>
      <div className="flex gap-2">
        <input
          id="buscar-cliente"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder="RUT (79.784.980-4) o nombre"
          className="flex-1 rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={buscando}
          className="rounded-sm border border-teal px-3 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-white disabled:opacity-50"
        >
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {elegido && (
        <p className="rounded-sm bg-valido-bg px-3 py-2 text-sm text-valido">
          Cliente: <span className="font-medium">{elegido.etiqueta}</span>{" "}
          <span className="font-mono text-xs">#{elegido.id}</span>
        </p>
      )}

      {resultados && resultados.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-sm border border-line p-1">
          {resultados.map((cliente) => (
            <li key={cliente.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(cliente);
                  setResultados(null);
                }}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
              >
                {cliente.etiqueta}
                {cliente.detalle && (
                  <span className="ml-2 text-xs text-ink-muted">{cliente.detalle}</span>
                )}
                <span className="ml-2 font-mono text-xs text-ink-muted">#{cliente.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
