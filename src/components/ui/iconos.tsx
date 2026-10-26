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

/* Secciones del panel lateral. */

/** Inicio: grafico de barras. */
export function IconoInicio() {
  return (
    <svg {...comunes}>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </svg>
  );
}

/** Nueva corrida: hoja con un signo mas. */
export function IconoGuia() {
  return (
    <svg {...comunes}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z" />
      <path d="M14 3v4h4" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

/** Guia manual: hoja con lapiz. */
export function IconoGuiaManual() {
  return (
    <svg {...comunes}>
      <path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
      <path d="M8 9h4M8 13h3" />
      <path d="m15.5 4.5 3 3L12 14H9v-3Z" />
    </svg>
  );
}

export function IconoHistorial() {
  return (
    <svg {...comunes}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v3h3" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function IconoEmpresas() {
  return (
    <svg {...comunes}>
      <path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15" />
      <path d="M14 9h5a1 1 0 0 1 1 1v10" />
      <path d="M3 20h18" />
      <path d="M8 8h2M8 12h2M8 16h2M17 13h0M17 16h0" />
    </svg>
  );
}

export function IconoCatalogo() {
  return (
    <svg {...comunes}>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4 7.5 8 4.5 8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function IconoTraspaso() {
  return (
    <svg {...comunes}>
      <path d="M4 8h14" />
      <path d="m15 5 3 3-3 3" />
      <path d="M20 16H6" />
      <path d="m9 13-3 3 3 3" />
    </svg>
  );
}

export function IconoUsuarios() {
  return (
    <svg {...comunes}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.5a6 6 0 0 1 3 5.5" />
    </svg>
  );
}

export function IconoSalir() {
  return (
    <svg {...comunes}>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9" />
    </svg>
  );
}
