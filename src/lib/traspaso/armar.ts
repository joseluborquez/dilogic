import type { FacturaLeida } from "./leer-factura";

/**
 * Convierte facturas de proveedor en guias de despacho con el producto
 * generico, en la menor cantidad posible de guias.
 *
 * Reglas (definidas por Dilogic el 24-oct-2026):
 * - Los productos repetidos entre facturas se juntan sumando cantidades.
 * - El total bruto de las guias es igual al de las facturas.
 * - Toda linea es afecta a IVA: Relbase cobra IVA a cualquier linea con el
 *   producto generico aunque se mande tax_affected false (guia 40974). Los
 *   impuestos especificos de la factura (ICA, IHA, IBLH, IBAZ) se cubren
 *   inflando todos los precios en proporcion a su neto; por eso el neto de las
 *   guias queda algo sobre el de las facturas cuando los hay.
 */

export const MAX_LINEAS_POR_GUIA = 60;
const IVA = 0.19;

export interface LineaGuiaTraspaso {
  descripcion: string;
  cantidad: number;
  /** Neto entero de la linea. */
  neto: number;
  /** Precio unitario con 6 decimales: cantidad x precio redondea al neto. */
  precio: number;
}

export interface GuiaTraspaso {
  lineas: LineaGuiaTraspaso[];
  neto: number;
  iva: number;
  total: number;
}

export interface ResultadoTraspaso {
  guias: GuiaTraspaso[];
  netoFacturas: number;
  totalFacturas: number;
  netoGuias: number;
  totalGuias: number;
  lineasFacturas: number;
}

function normalizar(nombre: string): string {
  return nombre.toUpperCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

function totalesGuia(lineas: LineaGuiaTraspaso[]): GuiaTraspaso {
  const neto = lineas.reduce((n, l) => n + l.neto, 0);
  const iva = Math.round(neto * IVA);
  return { lineas, neto, iva, total: neto + iva };
}

/** Reparte `objetivo` en enteros proporcionales a `pesos` (mayor resto). */
function repartir(pesos: number[], objetivo: number): number[] {
  const suma = pesos.reduce((n, p) => n + p, 0);
  const exactos = pesos.map((p) => (p * objetivo) / suma);
  const enteros = exactos.map(Math.floor);
  let resto = objetivo - enteros.reduce((n, x) => n + x, 0);
  const orden = exactos.map((_, i) => i).sort((a, b) => (exactos[b] % 1) - (exactos[a] % 1));
  for (const i of orden) {
    if (resto <= 0) break;
    enteros[i] += 1;
    resto -= 1;
  }
  return enteros;
}

export function armarTraspaso(facturas: FacturaLeida[]): ResultadoTraspaso {
  const netoFacturas = facturas.reduce((n, f) => n + f.neto, 0);
  const totalFacturas = facturas.reduce((n, f) => n + f.total, 0);

  // 1) Neto de cada producto: su parte del neto de su factura (el precio de
  //    venta trae IVA y, en algunas, impuestos especificos).
  const porProducto = new Map<string, { cantidad: number; neto: number }>();
  for (const f of facturas) {
    for (const l of f.lineas) {
      const clave = normalizar(l.nombre);
      const acumulado = porProducto.get(clave) ?? { cantidad: 0, neto: 0 };
      acumulado.cantidad += l.cantidad;
      acumulado.neto += (l.total * f.neto) / f.subtotal;
      porProducto.set(clave, acumulado);
    }
  }
  const productos = [...porProducto.entries()]
    .map(([descripcion, a]) => ({ descripcion, cantidad: Math.round(a.cantidad * 100) / 100, netoBase: a.neto }))
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion));

  // 2) Neto total que, con IVA, da el total bruto de las facturas; repartido
  //    en proporcion al neto de cada producto.
  const netoObjetivo = Math.round(totalFacturas / (1 + IVA));
  const netos = repartir(productos.map((p) => p.netoBase), netoObjetivo);
  const lineas: LineaGuiaTraspaso[] = productos.map((p, i) => ({
    descripcion: p.descripcion,
    cantidad: p.cantidad,
    neto: netos[i],
    precio: 0,
  }));

  // 3) La menor cantidad de guias de hasta 60 lineas, con las lineas
  //    repartidas parejo (61 -> 31 + 30, no 60 + 1). Ajuste fino: el IVA se
  //    redondea por guia, asi que se corrige peso a peso hasta que calce.
  const cantidadGuias = Math.max(1, Math.ceil(lineas.length / MAX_LINEAS_POR_GUIA));
  const grupos: LineaGuiaTraspaso[][] = [];
  for (let g = 0, inicio = 0; g < cantidadGuias; g += 1) {
    const tamano = Math.floor(lineas.length / cantidadGuias) + (g < lineas.length % cantidadGuias ? 1 : 0);
    grupos.push(lineas.slice(inicio, inicio + tamano));
    inicio += tamano;
  }
  const totalActual = () => grupos.reduce((n, g) => n + totalesGuia(g).total, 0);
  for (let intento = 0; intento < 200 && totalActual() !== totalFacturas; intento += 1) {
    const diferencia = totalFacturas - totalActual();
    const grupo = grupos[intento % grupos.length];
    // La linea de mayor neto absorbe el ajuste (un peso no se nota en ella).
    const linea = grupo.reduce((a, b) => (b.neto > a.neto ? b : a));
    linea.neto += Math.sign(diferencia);
  }
  if (totalActual() !== totalFacturas) {
    throw new Error("No se pudo cuadrar el total de las guías con el de las facturas.");
  }

  for (const l of lineas) l.precio = Math.round((l.neto / l.cantidad) * 1e6) / 1e6;
  const guias = grupos.map(totalesGuia);

  return {
    guias,
    netoFacturas,
    totalFacturas,
    netoGuias: guias.reduce((n, g) => n + g.neto, 0),
    totalGuias: guias.reduce((n, g) => n + g.total, 0),
    lineasFacturas: facturas.reduce((n, f) => n + f.lineas.length, 0),
  };
}
