/**
 * Iconos en SVG inline: sin dependencias ni peticiones externas, heredan el
 * color del boton que los contiene. Trazo de 1.5 para que pesen lo mismo que
 * el texto de la interfaz.
 */
const comunes = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: "size-4",
};

/** Abrir en una pestaña nueva. */
export function IconoVer() {
  return (
    <svg {...comunes}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function IconoDescargar() {
  return (
    <svg {...comunes}>
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function IconoEliminar() {
  return (
    <svg {...comunes}>
      <path d="M4 7h16" />
      <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" />
      <path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

export function IconoFlechaIzquierda() {
  return (
    <svg {...comunes}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}
