import type { ReactNode } from "react";

type Tono = "neutro" | "destructivo";

/**
 * Accion compacta de una fila de tabla. Solo icono, con el nombre en
 * `title`/`aria-label`: en una tabla de 30 filas, tres botones con texto por
 * fila serian 90 elementos compitiendo entre si. El contorno aparece al pasar
 * el cursor, asi que en reposo la tabla se lee como datos y no como controles.
 */
const BASE =
  "inline-flex size-8 items-center justify-center rounded-sm border border-transparent text-ink-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

const TONOS: Record<Tono, string> = {
  neutro: "hover:border-line hover:bg-surface-muted hover:text-teal focus-visible:outline-teal",
  destructivo: "hover:border-error hover:bg-error-bg hover:text-error focus-visible:outline-error",
};

interface PropsComunes {
  etiqueta: string;
  tono?: Tono;
  children: ReactNode;
}

/**
 * `<a>` y no `Link`: estas acciones no navegan dentro de la app, terminan en
 * un archivo (el endpoint redirige al PDF firmado). Con Link, Next intentaria
 * una navegacion de cliente y podria tocar el endpoint al pasar el cursor.
 */
export function AccionIconoEnlace({
  href,
  nuevaPestana,
  etiqueta,
  tono = "neutro",
  children,
}: PropsComunes & { href: string; nuevaPestana?: boolean }) {
  return (
    <a
      href={href}
      title={etiqueta}
      aria-label={etiqueta}
      {...(nuevaPestana ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`${BASE} ${TONOS[tono]}`}
    >
      {children}
    </a>
  );
}

export function AccionIconoBoton({
  onClick,
  deshabilitado,
  etiqueta,
  tono = "neutro",
  children,
}: PropsComunes & { onClick?: () => void; deshabilitado?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      title={etiqueta}
      aria-label={etiqueta}
      className={`${BASE} ${TONOS[tono]} disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-ink-muted`}
    >
      {children}
    </button>
  );
}
