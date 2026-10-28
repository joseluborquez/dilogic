"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cerrarSesionAction } from "@/app/login/actions";
import {
  IconoInicio,
  IconoCatalogo,
  IconoEmpresas,
  IconoGuia,
  IconoGuiaManual,
  IconoHistorial,
  IconoSalir,
  IconoTraspaso,
  IconoUsuarios,
} from "./iconos";

interface Seccion {
  href: string;
  titulo: string;
  icono: ReactNode;
  soloAdmin?: boolean;
}

// Las secciones viven aca y no llegan por props: un icono es una funcion y no
// puede viajar del servidor al cliente.
const SECCIONES: Seccion[] = [
  { href: "/", titulo: "Inicio", icono: <IconoInicio /> },
  { href: "/nueva-corrida", titulo: "Nueva corrida", icono: <IconoGuia /> },
  { href: "/guia-manual", titulo: "Guía manual", icono: <IconoGuiaManual /> },
  { href: "/historial", titulo: "Historial", icono: <IconoHistorial /> },
  { href: "/empresas", titulo: "Empresas", icono: <IconoEmpresas /> },
  { href: "/catalogo", titulo: "Catálogo", icono: <IconoCatalogo /> },
  { href: "/traspaso", titulo: "Traspaso de costos", icono: <IconoTraspaso />, soloAdmin: true },
  { href: "/usuarios", titulo: "Usuarios", icono: <IconoUsuarios />, soloAdmin: true },
];

function formatearActualizacion(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

/**
 * Navegacion de la app: columna a la izquierda en pantallas anchas, franja
 * arriba en el celular. Abajo, quien esta operando (las guias quedan a su
 * nombre), cuando se actualizaron los datos por ultima vez y como salir.
 */
export function PanelLateral({
  nombre,
  esAdmin,
  ultimaActualizacion,
}: {
  nombre: string;
  esAdmin: boolean;
  ultimaActualizacion: string | null;
}) {
  const ruta = usePathname();
  const secciones = SECCIONES.filter((s) => esAdmin || !s.soloAdmin);

  return (
    <aside className="vidrio flex flex-col gap-4 p-4 md:sticky md:top-4 md:h-[calc(100dvh-2rem)] md:w-60 md:shrink-0 md:gap-6 md:p-5">
      <p className="font-display text-xs font-semibold tracking-[0.2em] text-teal uppercase">
        Dilogic · Guías
      </p>

      <nav aria-label="Secciones" className="-mx-1 overflow-x-auto md:mx-0 md:overflow-visible">
        <ul className="flex gap-1 px-1 md:flex-col md:px-0">
          {secciones.map((s) => {
            const activa = s.href === "/" ? ruta === "/" : ruta === s.href || ruta.startsWith(`${s.href}/`);
            return (
              <li key={s.href} className="shrink-0">
                <Link
                  href={s.href}
                  aria-current={activa ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${
                    activa
                      ? "bg-teal/15 font-medium text-teal"
                      : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                  }`}
                >
                  {s.icono}
                  {s.titulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm md:mt-auto md:flex-col md:items-stretch">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {nombre}
            {esAdmin && <span className="ml-2 text-[11px] tracking-wider text-ink-muted uppercase">Admin</span>}
          </p>
          <p className="text-xs text-ink-muted">
            {ultimaActualizacion
              ? `Actualizado ${formatearActualizacion(ultimaActualizacion)}`
              : "Sin actualizaciones aún"}
          </p>
        </div>
        <form action={cerrarSesionAction}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-1.5 font-display text-sm font-medium text-ink-muted transition-colors hover:border-error hover:text-error"
          >
            <IconoSalir />
            Salir
          </button>
        </form>
      </div>
    </aside>
  );
}
