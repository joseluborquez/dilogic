/**
 * Pide el ZIP al servidor y dispara la descarga en el navegador. El endpoint
 * es POST (la seleccion puede ser larga), asi que no basta con un <a href>:
 * hay que convertir la respuesta en blob y simular el click.
 */
export interface ResultadoDescarga {
  faltantes: number;
  /** Cuantos archivos ZIP se descargaron (una seleccion grande se parte). */
  archivos: number;
}

function nombreDesdeCabecera(cabecera: string | null): string | null {
  if (!cabecera) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* cae al nombre simple */
    }
  }
  const simple = /filename="([^"]+)"/i.exec(cabecera);
  return simple ? simple[1] : null;
}

async function descargarParte(
  payload: { claves?: string[]; corridaId?: string },
  parte: number
): Promise<{ faltantes: number; partes: number }> {
  const res = await fetch("/api/guias/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, parte }),
  });

  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { mensaje?: string } | null;
    throw new Error(cuerpo?.mensaje ?? "No se pudo armar la descarga.");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreDesdeCabecera(res.headers.get("Content-Disposition")) ?? "guias.zip";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return {
    faltantes: Number(res.headers.get("X-Guias-Faltantes") ?? 0),
    partes: Number(res.headers.get("X-Guias-Partes") ?? 1),
  };
}

/**
 * Una seleccion grande no cabe en un solo ZIP (limite de memoria/tiempo de la
 * funcion): el servidor la parte y aca se piden las partes una tras otra, en
 * serie para no disparar varias descargas simultaneas.
 */
export async function descargarZipGuias(payload: {
  claves?: string[];
  corridaId?: string;
}): Promise<ResultadoDescarga> {
  const primera = await descargarParte(payload, 1);
  let faltantes = primera.faltantes;

  for (let parte = 2; parte <= primera.partes; parte += 1) {
    const siguiente = await descargarParte(payload, parte);
    faltantes += siguiente.faltantes;
  }

  return { faltantes, archivos: primera.partes };
}
