// Prueba de conectividad de solo lectura contra la API de Relbase. No crea ni
// modifica nada: muestra el estado de la conexion y hace GET /productos
// (pagina 1) y GET /dtes/guias/tipos_traslado para confirmar que la
// autorizacion funciona.
//
// Usa el mismo cliente que la app (v1 o v2 segun RELBASE_API_VERSION). En v2
// pide el token por obtenerAccessToken, que respeta el candado de renovacion:
// renovar por fuera rotaria el refresh_token y cortaria la conexion.
//
// Uso: npm run script scripts/test-relbase-connection.mts

import {
  emisionBloqueadaEnV2,
  listarProductosPagina,
  obtenerTiposTraslado,
  versionRelbase,
} from "@/lib/relbase/client";
import { obtenerCredencialesCompartidas } from "@/lib/relbase/credenciales";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";

const version = versionRelbase();
console.log(`Relbase API ${version}`);

if (version === "v2") {
  const conexion = await obtenerEstadoConexion();
  console.log(`Conexion OAuth: ${conexion.estado}`, {
    conectadoEn: conexion.conectadoEn,
    conectadoPor: conexion.conectadoPor,
    ultimoError: conexion.ultimoError,
    scopesFaltantes: conexion.scopesFaltantes,
  });
  console.log(`Emision de guias: ${emisionBloqueadaEnV2() ? "BLOQUEADA" : "habilitada"}`);
}

const credenciales = await obtenerCredencialesCompartidas();

console.log("\n--- GET /productos (pagina 1) ---");
const pagina = await listarProductosPagina(credenciales, 1);
console.log(
  `${pagina.data.products.length} productos en la pagina; ${pagina.meta.total_count} en total (${pagina.meta.total_pages} paginas).`
);
console.log("Ejemplo:", pagina.data.products[0]?.code, pagina.data.products[0]?.name);

console.log("\n--- GET /dtes/guias/tipos_traslado ---");
const tipos = await obtenerTiposTraslado(credenciales);
for (const t of tipos) console.log(`  ${t.id}: ${t.name}`);

console.log("\nOK: Relbase responde.");
