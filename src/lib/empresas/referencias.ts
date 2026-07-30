import type { RelbaseReferencia } from "@/lib/relbase/types";

/** Como se muestra un registro de referencia de Relbase en pantalla. */
export interface OpcionReferencia {
  id: number;
  etiqueta: string;
  detalle: string | null;
  /** Solo en clientes: datos que rellenan la direccion de despacho. */
  direccion?: string | null;
  ciudadId?: number | null;
  comunaId?: number | null;
}

function primerTexto(obj: RelbaseReferencia, claves: string[]): string | null {
  for (const clave of claves) {
    const valor = obj[clave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return null;
}

function primerNumero(obj: RelbaseReferencia, claves: string[]): number | null {
  for (const clave of claves) {
    const valor = obj[clave];
    if (typeof valor === "number") return valor;
    // Relbase a veces anida el objeto completo ({ city: { id, name } }).
    if (valor && typeof valor === "object" && "id" in valor) {
      const id = (valor as { id: unknown }).id;
      if (typeof id === "number") return id;
    }
  }
  return null;
}

/**
 * Los nombres de campo de las respuestas de referencia de Relbase no estan
 * documentados y difieren entre endpoints, asi que se prueban los candidatos
 * razonables en vez de fijar uno. Si ninguno calza, queda el id a la vista para
 * que igual se pueda elegir.
 */
export function aOpcion(registro: RelbaseReferencia): OpcionReferencia {
  const nombre =
    primerTexto(registro, ["name", "business_name", "razon_social", "nombre", "description"]) ??
    `#${registro.id}`;
  const detalle = primerTexto(registro, ["rut", "identifier", "code", "address", "direccion"]);

  return {
    id: registro.id,
    etiqueta: nombre,
    detalle,
    direccion: primerTexto(registro, ["address", "direccion", "street"]),
    ciudadId: primerNumero(registro, ["city_id", "ciudad_id", "city"]),
    comunaId: primerNumero(registro, ["commune_id", "comuna_id", "commune"]),
  };
}
