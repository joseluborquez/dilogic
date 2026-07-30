import Link from "next/link";
import { IconoFlechaIzquierda } from "./iconos";

/**
 * Enlace de vuelta con forma de boton. Mismo lenguaje que EnlaceSeccion
 * (contorno, no relleno) pero compacto, porque vive en la esquina del
 * encabezado y no es la accion principal de ninguna pantalla.
 */
export function BotonVolver({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 py-1.5 font-display text-sm font-medium text-ink transition-colors hover:border-teal hover:text-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
    >
      <IconoFlechaIzquierda />
      {children}
    </Link>
  );
}
