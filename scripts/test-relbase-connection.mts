// Prueba de conectividad de solo lectura contra la API de Relbase. No crea ni
// modifica nada: muestra el estado de la conexion y hace GET /productos
// (pagina 1) y GET /dtes/guias/tipos_traslado para confirmar que la
// autorizacion funciona.
//
// Usa el mismo cliente que la app: pide el token por obtenerAccessToken, que
// respeta el candado de renovacion. Renovar por fuera rotaria el
// refresh_token y cortaria la conexion de produccion.
//
// Uso: npm run script scripts/test-relbase-connection.mts

import { listarProductosPagina, obtenerTiposTraslado } from "@/lib/relbase/client";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";

const conexion = await obtenerEstadoConexion();
console.log(`Conexion OAuth con Relbase: ${conexion.estado}`, {
  conectadoEn: conexion.conectadoEn,
  conectadoPor: conexion.conectadoPor,
  ultimoError: conexion.ultimoError,
  scopesFaltantes: conexion.scopesFaltantes,
});

console.log("\n--- GET /productos (pagina 1) ---");
const pagina = await listarProductosPagina(1);
console.log(
  `${pagina.data.products.length} productos en la pagina; ${pagina.meta.total_count} en total (${pagina.meta.total_pages} paginas).`
);
console.log("Ejemplo:", pagina.data.products[0]?.code, pagina.data.products[0]?.name);

console.log("\n--- GET /dtes/guias/tipos_traslado ---");
const tipos = await obtenerTiposTraslado();
for (const t of tipos) console.log(`  ${t.id}: ${t.name}`);

console.log("\nOK: Relbase responde.");
