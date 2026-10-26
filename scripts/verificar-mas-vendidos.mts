/**
 * Verifica "Más vendidos" de la pagina de Ventas contra la base: suma cada
 * grupo a mano desde ventas_lineas y lo compara con juntarMismoProducto.
 * Solo lectura.
 *
 *   npm run script scripts/verificar-mas-vendidos.mts 2026-10-01 2026-10-26
 */
import { calcularAgregado } from "@/lib/ventas/indicadores";
import { conversionDe, juntarMismoProducto } from "@/lib/ventas/mismo-producto";

const [desde, hasta] = process.argv.slice(2);
const datos = await calcularAgregado(desde, hasta);
const ranking = datos.productos.filter((p) => p.grupo !== "AMS" && p.grupo !== "GENERICO");
const filas = juntarMismoProducto(ranking);

// Control 1: juntar no pierde ni duplica plata.
const montoAntes = ranking.reduce((s, p) => s + p.monto, 0);
const montoDespues = filas.reduce((s, f) => s + f.monto, 0);
console.log(`monto productos ${Math.round(montoAntes)} · monto filas ${Math.round(montoDespues)} · ${Math.abs(montoAntes - montoDespues) < 1 ? "OK" : "DIFERENCIA"}`);

// Control 2: cada fila = suma de sus partes convertidas.
let malas = 0;
for (const f of filas) {
  const base = conversionDe(f.partes[0].producto.codigo).factor;
  const esperado = f.partes.reduce((s, x) => s + (x.producto.cantidad * conversionDe(x.producto.codigo).factor) / base, 0);
  if (Math.abs(esperado - f.cantidad) > 1e-6) malas += 1;
}
console.log(`filas con cantidad mal sumada: ${malas}`);

const top = (orden: (a: (typeof filas)[0], b: (typeof filas)[0]) => number) => [...filas].sort(orden).slice(0, 10);
for (const [titulo, lista] of [
  ["POR CANTIDAD", top((a, b) => b.cantidad - a.cantidad)],
  ["POR MONTO", top((a, b) => b.monto - a.monto)],
] as const) {
  console.log(`\n${titulo}`);
  for (const f of lista) {
    const partes = f.partes.map((x) => `${x.producto.codigo} ${x.producto.cantidad}${x.equivalente !== x.producto.cantidad ? `→${Math.round(x.equivalente * 10) / 10}` : ""}`).join(" + ");
    console.log(`${f.nombre.padEnd(34)} ${String(Math.round(f.cantidad * 10) / 10).padStart(8)} ${f.unidad.padEnd(8)} $${Math.round(f.monto).toLocaleString("es-CL").padStart(11)}  ${partes}`);
  }
}
