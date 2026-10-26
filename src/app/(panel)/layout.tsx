import { PanelLateral } from "@/components/ui/PanelLateral";
import { requerirUsuario } from "@/lib/auth/sesion";
import { obtenerUltimaSincronizacion } from "@/lib/catalogo/sincronizar";
import { obtenerUltimaActualizacionVentas } from "@/lib/ventas/sincronizar";

/**
 * Marco de todas las pantallas con sesion: panel lateral + contenido. El
 * login queda fuera del grupo. Cada pagina sigue validando la sesion por su
 * cuenta: un layout no se vuelve a ejecutar al navegar entre paginas.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const [usuario, ventas, catalogo] = await Promise.all([
    requerirUsuario(),
    obtenerUltimaActualizacionVentas(),
    obtenerUltimaSincronizacion(),
  ]);
  // Lo que importa al leer los indicadores es cuan frescas son las ventas; el
  // catalogo queda de respaldo mientras no haya ninguna carga de ventas.
  const ultimaActualizacion = ventas ?? (catalogo ? (catalogo.terminadaEn ?? catalogo.iniciadaEn) : null);

  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row">
      <PanelLateral
        nombre={usuario.nombre ?? usuario.email}
        esAdmin={usuario.rol === "admin"}
        ultimaActualizacion={ultimaActualizacion}
      />
      <main className="flex min-w-0 flex-1 flex-col px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
