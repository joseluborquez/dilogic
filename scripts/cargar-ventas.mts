/**
 * Carga (o completa) las ventas desde una fecha: guias tipo 52 de Relbase con
 * sus productos. Sin limite de tiempo, para la carga inicial; la diaria la
 * hace el cron /api/cron/sincronizar-ventas.
 *
 *   npm run script scripts/cargar-ventas.mts 2026-04-01
 */
import { sincronizarVentas } from "@/lib/ventas/sincronizar";

const desde = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(desde ?? "")) {
  console.error("Uso: npm run script scripts/cargar-ventas.mts AAAA-MM-DD");
  process.exit(1);
}
const resumen = await sincronizarVentas({ desde, origen: "carga_inicial" });
console.log(resumen);
