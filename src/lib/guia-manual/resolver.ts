/**
 * Que producto y que precio lleva cada linea de una guia manual segun la
 * opcion de precio elegida. Sin dependencias de servidor: la usan la pantalla
 * (para mostrar lo que saldra) y el servidor (para revalidar antes de emitir).
 *
 * - "alto" / "bajo": entre el producto elegido y sus equivalentes en las otras
 *   empresas (equivalencias.json), el de precio mas alto / mas bajo.
 * - "CERQ" / "YDR" / "MTX": el equivalente de esa empresa. Si no hay calce
 *   exacto, la linea va como PRODUCTO GENERICO con el nombre del producto
 *   elegido como descripcion y su precio de los ultimos 3 meses.
 */
import equivalencias from "./equivalencias.json";
import { PRODUCTO_GENERICO } from "@/lib/catalogo/generico";

export { PRODUCTO_GENERICO };

export type OpcionPrecio = "alto" | "bajo" | "CERQ" | "YDR" | "MTX";

export const OPCIONES_PRECIO: { valor: OpcionPrecio; etiqueta: string; ayuda: string }[] = [
  { valor: "alto", etiqueta: "Precio más alto", ayuda: "Entre las empresas que tienen el producto, el precio más alto." },
  { valor: "bajo", etiqueta: "Precio más bajo", ayuda: "Entre las empresas que tienen el producto, el precio más bajo." },
  { valor: "CERQ", etiqueta: "Solo Cermaq", ayuda: "Códigos y precios de Cermaq; lo que Cermaq no tenga va como genérico." },
  { valor: "YDR", etiqueta: "Solo Yadran", ayuda: "Códigos y precios de Yadran; lo que Yadran no tenga va como genérico." },
  { valor: "MTX", etiqueta: "Solo Multiexport", ayuda: "Códigos y precios de Multiexport; lo que no tenga va como genérico." },
];

export const NOMBRE_EMPRESA: Record<string, string> = { CERQ: "Cermaq", YDR: "Yadran", MTX: "Multiexport" };

/** Producto elegible en la guia (del catalogo de la app o de Relbase). */
export interface ProductoGuia {
  productId: number;
  codigo: string;
  nombre: string;
  /** CERQ / YDR / MTX, o null para otros codigos de Relbase. */
  empresa: string | null;
  familia: string | null;
  /** Ultimo precio cobrado en los ultimos 3 meses; si no se vendio, el del catalogo. */
  precio: number | null;
  /** De donde salio `precio`. */
  origenPrecio: "ventas" | "catalogo" | null;
}

export interface LineaResuelta {
  productId: number;
  codigo: string;
  /** Lo que se imprime: el nombre del producto, o la descripcion del generico. */
  nombre: string;
  /** Solo en el generico: descripcion propia de la linea. */
  descripcion: string | null;
  precio: number | null;
  esGenerico: boolean;
  /** Explicacion corta para la pantalla ("el más alto de 3"). */
  motivo: string;
}

const GRUPO_DE = new Map<string, string[]>();
for (const grupo of equivalencias as string[][]) for (const codigo of grupo) GRUPO_DE.set(codigo, grupo);

/** El producto y sus equivalentes en las otras empresas (incluido el mismo). */
export function equivalentesDe(codigo: string): string[] {
  return GRUPO_DE.get(codigo) ?? [codigo];
}

export function resolverLinea(
  elegido: ProductoGuia,
  opcion: OpcionPrecio,
  porCodigo: Map<string, ProductoGuia>
): LineaResuelta {
  const comoEsta = (p: ProductoGuia, motivo: string): LineaResuelta => ({
    productId: p.productId,
    codigo: p.codigo,
    nombre: p.nombre,
    descripcion: null,
    precio: p.precio,
    esGenerico: false,
    motivo,
  });

  const grupo = equivalentesDe(elegido.codigo)
    .map((c) => porCodigo.get(c))
    .filter((p): p is ProductoGuia => p != null);

  if (opcion === "alto" || opcion === "bajo") {
    const conPrecio = grupo.filter((p) => p.precio != null);
    if (conPrecio.length <= 1) return comoEsta(elegido, grupo.length > 1 ? "sus equivalentes no tienen precio" : "sin equivalentes");
    const elegidoPorPrecio = conPrecio.reduce((a, b) =>
      opcion === "alto" ? (b.precio! > a.precio! ? b : a) : b.precio! < a.precio! ? b : a
    );
    return comoEsta(
      elegidoPorPrecio,
      `el ${opcion === "alto" ? "más alto" : "más bajo"} de ${conPrecio.length} (${conPrecio
        .map((p) => NOMBRE_EMPRESA[p.empresa ?? ""] ?? p.codigo)
        .join(", ")})`
    );
  }

  const deEsaEmpresa = grupo.find((p) => p.empresa === opcion);
  if (deEsaEmpresa) {
    return comoEsta(deEsaEmpresa, deEsaEmpresa.codigo === elegido.codigo ? "de la empresa elegida" : `equivalente de ${NOMBRE_EMPRESA[opcion]}`);
  }
  return {
    productId: PRODUCTO_GENERICO.productId,
    codigo: PRODUCTO_GENERICO.codigo,
    nombre: elegido.nombre,
    descripcion: elegido.nombre,
    precio: elegido.precio,
    esGenerico: true,
    motivo: `${NOMBRE_EMPRESA[opcion]} no tiene este producto: va como genérico`,
  };
}
