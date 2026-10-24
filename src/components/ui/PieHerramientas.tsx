import Link from "next/link";

export interface Herramienta {
  href: string;
  titulo: string;
}

/**
 * Secciones secundarias al pie de la pantalla de inicio, en texto discreto:
 * la pantalla es para hacer guias y nada mas debe competir con eso.
 */
export function PieHerramientas({ herramientas }: { herramientas: Herramienta[] }) {
  if (herramientas.length === 0) return null;
  return (
    <nav aria-label="Herramientas" className="mt-auto border-t border-line pt-4 text-sm">
      <p className="mb-2 text-xs tracking-widest text-ink-muted uppercase">Herramientas</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {herramientas.map((h) => (
          <li key={h.href}>
            <Link href={h.href} className="text-ink-muted transition-colors hover:text-teal hover:underline">
              {h.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
