import type { ReactNode } from "react";

/**
 * Un bloque de la pagina de inicio. Siempre con una linea corta de ayuda: la
 * pagina la lee tambien gente que no participo en armarla. Una linea, no un
 * parrafo: Hugo pidio menos texto (26-oct).
 */
export function Bloque({
  titulo,
  comoLeer,
  children,
  id,
}: {
  titulo: string;
  comoLeer: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="vidrio flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">{titulo}</h2>
        <p className="text-sm text-ink-muted">{comoLeer}</p>
      </header>
      {children}
    </section>
  );
}
