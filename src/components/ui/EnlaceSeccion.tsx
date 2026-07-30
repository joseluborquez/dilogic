import Link from "next/link";

interface Props {
  href: string;
  titulo: string;
  descripcion: string;
}

/**
 * Enlace a otra seccion con forma de boton. Deliberadamente en estilo
 * secundario (contorno, no relleno): en cada pantalla el boton lleno es la
 * accion principal (validar, generar, buscar), y la navegacion no debe
 * competir con ella.
 */
export function EnlaceSeccion({ href, titulo, descripcion }: Props) {
  return (
    <Link
      href={href}
      className="group flex flex-1 items-center justify-between gap-3 rounded-sm border border-line bg-surface px-4 py-3 transition-colors hover:border-teal focus-visible:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
    >
      <span className="min-w-0">
        <span className="block font-display text-sm font-medium transition-colors group-hover:text-teal">
          {titulo}
        </span>
        <span className="block text-xs text-ink-muted">{descripcion}</span>
      </span>
      <span
        aria-hidden
        className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-teal motion-reduce:transition-none"
      >
        →
      </span>
    </Link>
  );
}
