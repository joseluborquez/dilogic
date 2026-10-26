"use client";

import { useId, useState } from "react";
import { NOMBRE_EMPRESA, type ProductoGuia } from "@/lib/guia-manual/resolver";
import { detalleSugerencia, type Sugerencia } from "@/lib/guia-manual/sugerencias";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(n));

/**
 * Elegir o cambiar el producto de una linea escribiendo: al escribir se
 * sugieren productos con el MAS CARO de cada grupo primero (sugerirProductos);
 * sin escribir se muestran los candidatos que encontro el cruce.
 */
export function BuscadorProducto({
  actual,
  candidatos,
  sugerir,
  onElegir,
  onGenerico,
}: {
  /** Lo que esta elegido ahora (null = producto generico). */
  actual: ProductoGuia | null;
  candidatos: ProductoGuia[];
  sugerir: (texto: string) => Sugerencia[];
  onElegir: (p: ProductoGuia) => void;
  onGenerico: () => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const opciones: Sugerencia[] = texto.trim() ? sugerir(texto) : candidatos.map((p) => ({ producto: p, otros: [] }));

  const elegir = (p: ProductoGuia | null) => {
    if (p) onElegir(p);
    else onGenerico();
    setTexto("");
    setAbierto(false);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={abierto}
        aria-controls={id}
        value={abierto ? texto : actual ? `${actual.nombre} (${actual.codigo})` : "Producto genérico"}
        placeholder={actual ? `${actual.nombre} (${actual.codigo})` : "Escribe para buscar…"}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAbierto(false);
          if (e.key === "Enter" && opciones[0]) {
            e.preventDefault();
            elegir(opciones[0].producto);
          }
        }}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-teal focus:outline-none"
      />
      {abierto && (
        <ul id={id} role="listbox" className="vidrio absolute z-10 mt-1 max-h-80 w-full min-w-80 overflow-y-auto p-1 text-sm">
          {opciones.length === 0 && <li className="px-3 py-2 text-ink-muted">Ningún producto coincide.</li>}
          {opciones.map((s) => (
            <li key={s.producto.codigo} role="option" aria-selected={s.producto.codigo === actual?.codigo}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(s.producto)}
                className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate">{s.producto.nombre}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {s.producto.codigo} · {s.producto.empresa ? NOMBRE_EMPRESA[s.producto.empresa] : "producto creado"}
                    {s.otros.length > 0 && <> · {detalleSugerencia(s, pesos)}</>}
                  </span>
                </span>
                <span className="shrink-0 font-mono">{s.producto.precio != null ? pesos(s.producto.precio) : "sin precio"}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => elegir(null)}
              className="w-full rounded-md px-3 py-2 text-left text-ink-muted hover:bg-surface-muted"
            >
              Producto genérico (con la descripción del cliente)
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
