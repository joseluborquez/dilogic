"use client";

import { useState, useTransition } from "react";
import { buscarReferenciaRelbaseAction } from "@/app/empresas/actions";
import type { OpcionReferencia } from "@/lib/empresas/referencias";

interface Props {
  tipo: "ciudad" | "comuna";
  etiqueta: string;
  /** Campo oculto que viaja en el formulario con el id elegido. */
  nombreCampo: string;
  valor: string;
  onElegir: (opcion: OpcionReferencia) => void;
  /** Nombre a mostrar cuando el valor vino del cliente de Relbase. */
  nombreElegido: string | null;
}

/**
 * Busca una ciudad o comuna por nombre y guarda su id. Los identificadores de
 * Relbase no estan publicados en ninguna parte: pedirlos escritos a mano
 * obligaba a adivinarlos o a mirar otra empresa ya creada.
 */
export function BuscadorReferencia({
  tipo,
  etiqueta,
  nombreCampo,
  valor,
  onElegir,
  nombreElegido,
}: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<OpcionReferencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, iniciar] = useTransition();

  function buscar() {
    setError(null);
    iniciar(async () => {
      const respuesta = await buscarReferenciaRelbaseAction(tipo, texto);
      if (respuesta.ok) {
        setResultados(respuesta.opciones);
      } else {
        setResultados(null);
        setError(respuesta.mensaje);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`buscar-${tipo}`} className="text-xs tracking-wide text-ink-muted uppercase">
        {etiqueta}
      </label>
      <input type="hidden" name={nombreCampo} value={valor} />

      {valor ? (
        <div className="flex items-center justify-between gap-2 rounded-sm border border-line bg-paper px-3 py-2 text-sm">
          <span>
            {nombreElegido ?? `${etiqueta} seleccionada`}{" "}
            <span className="font-mono text-xs text-ink-muted">#{valor}</span>
          </span>
          <button
            type="button"
            onClick={() => onElegir({ id: 0, etiqueta: "", detalle: null })}
            className="shrink-0 text-xs text-ink-muted hover:underline"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            id={`buscar-${tipo}`}
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                buscar();
              }
            }}
            placeholder={tipo === "ciudad" ? "Ej: Quellón" : "Ej: Puerto Montt"}
            className="flex-1 rounded-sm border border-line bg-paper px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={buscar}
            disabled={buscando}
            className="rounded-sm border border-teal px-3 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-white disabled:opacity-50"
          >
            {buscando ? "…" : "Buscar"}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {resultados && resultados.length > 0 && !valor && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-sm border border-line p-1">
          {resultados.map((opcion) => (
            <li key={opcion.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(opcion);
                  setResultados(null);
                }}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
              >
                {opcion.etiqueta}
                <span className="ml-2 font-mono text-xs text-ink-muted">#{opcion.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
