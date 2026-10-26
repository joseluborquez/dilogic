import type { ReactNode } from "react";
import { EnlaceVentas } from "./Navegacion";

/**
 * Graficos de la pagina de inicio: una sola serie, color de acento, valor a
 * la vista y detalle al pasar el mouse. Las barras con href aplican el filtro
 * (mes, empresa o familia), asi el grafico tambien sirve para navegar.
 */

const SIGLAS = new Set(["iqf", "uht", "pet", "wc"]);
const UNIDADES = new Set(["kg", "g", "gr", "grs", "lt", "lts", "ml", "cc", "un", "und", "unid"]);

/** "SALMON FILETE IQF 1 KG" -> "Salmon filete IQF 1 kg": los nombres de Relbase vienen en mayusculas. */
export function nombreLegible(nombre: string): string {
  const palabras = nombre.trim().replace(/\s+/g, " ").toLowerCase().split(" ");
  return palabras
    .map((w, i) => {
      const limpia = w.replace(/[^a-zñáéíóú]/g, "");
      if (SIGLAS.has(limpia)) return w.toUpperCase();
      if (i === 0 && !UNIDADES.has(limpia)) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

function Barra({ fraccion, atenuada }: { fraccion: number; atenuada?: boolean }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <span
        className={`block h-full rounded-full bg-teal transition-opacity ${atenuada ? "opacity-35 group-hover:opacity-70" : ""}`}
        style={{ width: `${Math.max(1.5, fraccion * 100)}%` }}
      />
    </span>
  );
}

function Cambio({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  const r = Math.round(v);
  return (
    <span className={`text-xs ${r === 0 ? "text-ink-muted" : r > 0 ? "text-valido" : "text-error"}`}>
      {r === 0 ? "=" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`}
    </span>
  );
}

function Envoltura({ href, activo, title, className, children }: { href?: string; activo?: boolean; title: string; className: string; children: ReactNode }) {
  return href ? (
    <EnlaceVentas href={href} activo={activo} title={title} className={`group ${className} rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal`}>
      {children}
    </EnlaceVentas>
  ) : (
    <div title={title} className={`group ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface BarraMes {
  clave: string;
  /** "oct" / "oct*" */
  etiqueta: string;
  /** null = mes sin datos cargados. */
  valor: number | null;
  texto: string;
  detalle: string;
  href: string;
  activo: boolean;
}

/** Columnas por mes; la del mes elegido en acento pleno, las otras atenuadas. */
export function GraficoMeses({ puntos }: { puntos: BarraMes[] }) {
  const max = Math.max(1, ...puntos.map((p) => p.valor ?? 0));
  const AREA = 150;
  return (
    <div className="grid items-end gap-3" style={{ gridTemplateColumns: `repeat(${puntos.length}, minmax(0, 1fr))` }}>
      {puntos.map((p) => {
        const alto = p.valor ? Math.max(3, (p.valor / max) * AREA) : 0;
        return (
          <Envoltura key={p.clave} href={p.href} activo={p.activo} title={p.detalle} className="flex flex-col items-center gap-1.5">
            <span className={`font-mono text-xs whitespace-nowrap ${p.activo ? "font-semibold text-ink" : "text-ink-muted"}`}>
              {p.valor == null ? "—" : p.texto}
            </span>
            <span className="flex w-full justify-center" style={{ height: AREA }}>
              <span
                className={`mt-auto w-full max-w-10 rounded-t-md bg-teal transition-opacity ${p.activo ? "" : "opacity-35 group-hover:opacity-70"}`}
                style={{ height: alto }}
              />
            </span>
            <span className={`w-full border-t border-line pt-1.5 text-center text-xs ${p.activo ? "font-medium text-ink" : "text-ink-muted"}`}>{p.etiqueta}</span>
          </Envoltura>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface FilaBarra {
  clave: string;
  etiqueta: string;
  /** Detalle chico junto al nombre (cantidad, empresas). */
  nota?: string;
  valor: number;
  texto: string;
  /** Variacion %; null = sin comparacion. */
  cambio?: number | null;
  detalle: string;
  href?: string;
  activo?: boolean;
}

/** Reparto por empresa o familia: nombre y monto en una linea, barra fina debajo. */
export function BarrasReparto({ filas, hayActivo = false }: { filas: FilaBarra[]; hayActivo?: boolean }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <ul className="flex flex-col gap-3">
      {filas.map((f) => (
        <li key={f.clave}>
          <Envoltura href={f.href} activo={f.activo} title={f.detalle} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className={f.activo ? "font-medium text-teal" : ""}>{f.etiqueta}</span>
              <span className="flex items-baseline gap-2 font-mono">
                {f.texto}
                <Cambio v={f.cambio} />
              </span>
            </span>
            <Barra fraccion={f.valor / max} atenuada={hayActivo && !f.activo} />
          </Envoltura>
        </li>
      ))}
    </ul>
  );
}

/** Ranking: una fila por producto (posicion, nombre, barra, monto). */
export function Ranking({ filas }: { filas: FilaBarra[] }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <ol className="flex flex-col divide-y divide-line">
      {filas.map((f, i) => (
        <li key={f.clave} title={f.detalle} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,30%)_7.5rem]">
          <span className="font-mono text-xs text-ink-muted">{i + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm">{nombreLegible(f.etiqueta)}</span>
            {f.nota && <span className="block truncate text-xs text-ink-muted">{f.nota}</span>}
          </span>
          <span className="hidden sm:block">
            <Barra fraccion={f.valor / max} />
          </span>
          <span className="text-right font-mono text-sm">{f.texto}</span>
        </li>
      ))}
    </ol>
  );
}
