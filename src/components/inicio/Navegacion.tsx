"use client";

import { createContext, useContext, useTransition, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Cambiar de mes o de filtro vuelve a pedir la pagina al servidor (~1 s).
 * Sin aviso parecia que nada pasaba: aca la navegacion va en una transicion y
 * mientras dura el contenido se atenua y la barra de filtros dice
 * "Actualizando…".
 */
const Contexto = createContext<{ navegar: (href: string) => void; pendiente: boolean } | null>(null);

export function NavegacionVentas({ barra, children }: { barra: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const navegar = (href: string) => iniciar(() => router.push(href, { scroll: false }));
  return (
    <Contexto.Provider value={{ navegar, pendiente }}>
      {barra}
      <div className={`flex flex-col gap-6 transition-opacity duration-200 ${pendiente ? "pointer-events-none opacity-50" : ""}`} aria-busy={pendiente}>
        {children}
      </div>
    </Contexto.Provider>
  );
}

export interface OpcionFiltro {
  valor: string;
  etiqueta: string;
}

export interface Filtro {
  nombre: string;
  activo: string;
  opciones: OpcionFiltro[];
  /** href de cada valor, calculado en el servidor. */
  hrefs: Record<string, string>;
}

/** Barra de filtros: un desplegable por filtro, en una sola fila. */
export function BarraFiltros({ filtros, limpiar }: { filtros: Filtro[]; limpiar: string | null }) {
  const ctx = useContext(Contexto);
  return (
    <div className="vidrio flex flex-wrap items-center gap-3 px-4 py-3">
      {filtros.map((f) => (
        <label key={f.nombre} className="flex min-w-0 flex-1 basis-40 flex-col gap-1 sm:flex-none sm:basis-auto">
          <span className="sr-only">{f.nombre}</span>
          <select
            value={f.activo}
            onChange={(e) => ctx?.navegar(f.hrefs[e.target.value])}
            className={`rounded-lg border bg-paper px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-teal ${
              f.activo && f.nombre !== "Mes" ? "border-teal text-ink" : "border-line text-ink"
            }`}
          >
            {f.opciones.map((o) => (
              <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
            ))}
          </select>
        </label>
      ))}
      {limpiar && (
        <button type="button" onClick={() => ctx?.navegar(limpiar)} className="text-sm text-ink-muted hover:text-teal">
          Quitar filtros
        </button>
      )}
      <span className={`ml-auto flex items-center gap-2 text-xs text-ink-muted transition-opacity ${ctx?.pendiente ? "opacity-100" : "opacity-0"}`} aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-teal" />
        {ctx?.pendiente ? "Actualizando…" : ""}
      </span>
    </div>
  );
}

/** Enlace que navega dentro de la transicion (las barras de los graficos). */
export function EnlaceVentas({ href, className, title, children, activo }: { href: string; className?: string; title?: string; children: ReactNode; activo?: boolean }) {
  const ctx = useContext(Contexto);
  const ir = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!ctx || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    ctx.navegar(href);
  };
  return (
    <a href={href} onClick={ir} className={className} title={title} aria-current={activo ? "true" : undefined}>
      {children}
    </a>
  );
}
