"use client";

import { useState } from "react";
import { useNavegarVentas } from "@/components/inicio/Navegacion";

/**
 * Calendario para elegir el periodo de un reporte. Hugo no despacha siempre los
 * mismos dias (04-11): los dias con guias van marcados y solo esos se pueden
 * tocar. Primer toque = inicio, segundo = fin; un tercero empieza de nuevo.
 */

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const mesDe = (iso: string) => iso.slice(0, 7);
function moverMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function Mes({
  mes,
  dias,
  desde,
  hasta,
  elegir,
}: {
  mes: string;
  dias: Record<string, number>;
  desde: string;
  hasta: string;
  elegir: (f: string) => void;
}) {
  const [a, m] = mes.split("-").map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const blancos = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7; // lunes primero
  const fin = hasta || desde;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm font-medium capitalize">
        {MESES[m - 1]} {a}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {DIAS.map((d, i) => (
          <span key={i} className="py-1 text-ink-muted">
            {d}
          </span>
        ))}
        {Array.from({ length: blancos }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const f = `${mes}-${String(i + 1).padStart(2, "0")}`;
          const guias = dias[f] ?? 0;
          const borde = f === desde || f === fin;
          const dentro = desde && f > desde && f < fin;
          return (
            <button
              key={f}
              type="button"
              disabled={!guias}
              onClick={() => elegir(f)}
              title={guias ? `${guias} ${guias === 1 ? "guía" : "guías"}` : "Sin guías"}
              className={`relative rounded-md py-1.5 tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-teal ${
                borde
                  ? "bg-teal font-semibold text-on-accent"
                  : dentro
                    ? guias
                      ? "bg-teal/15 font-semibold text-ink"
                      : "bg-teal/15 text-ink-muted"
                    : guias
                      ? "font-semibold text-ink hover:bg-surface-muted"
                      : "cursor-default text-ink-muted/50"
              }`}
            >
              {i + 1}
              {guias > 0 && !borde && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-teal" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Calendario({
  dias,
  desde,
  hasta,
  plantilla,
}: {
  /** yyyy-mm-dd -> guias de ese dia. */
  dias: Record<string, number>;
  desde: string;
  hasta: string;
  /** href de la pagina con __D__ y __H__ en lugar de las fechas (lo arma el servidor). */
  plantilla: string;
}) {
  const nav = useNavegarVentas();
  const conGuias = Object.keys(dias).sort();
  const ultimoMes = mesDe(hasta || desde || conGuias.at(-1) || new Date().toISOString());
  const [derecha, setDerecha] = useState(ultimoMes);
  const primero = conGuias[0] ? mesDe(conGuias[0]) : derecha;
  const ultimo = conGuias.at(-1) ? mesDe(conGuias.at(-1)!) : derecha;

  const ir = (d: string, h: string) => {
    const href = plantilla.replace("__D__", d).replace("__H__", h);
    if (nav) nav.navegar(href);
    else window.location.href = href;
  };
  const elegir = (f: string) => {
    if (!desde || hasta) return ir(f, "");
    if (f === desde) return ir(f, f);
    return f < desde ? ir(f, desde) : ir(desde, f);
  };

  const flecha = "rounded-md px-2 py-1 text-ink-muted transition-colors hover:text-teal disabled:opacity-30 disabled:hover:text-ink-muted";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <button type="button" className={flecha} onClick={() => setDerecha(moverMes(derecha, -1))} disabled={moverMes(derecha, -1) <= primero} aria-label="Meses anteriores">
          ‹
        </button>
        <div className="grid flex-1 gap-6 sm:grid-cols-2">
          <Mes mes={moverMes(derecha, -1)} dias={dias} desde={desde} hasta={hasta} elegir={elegir} />
          <Mes mes={derecha} dias={dias} desde={desde} hasta={hasta} elegir={elegir} />
        </div>
        <button type="button" className={flecha} onClick={() => setDerecha(moverMes(derecha, 1))} disabled={derecha >= ultimo} aria-label="Meses siguientes">
          ›
        </button>
      </div>
    </div>
  );
}
