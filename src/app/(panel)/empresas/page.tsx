import { requerirUsuario } from "@/lib/auth/sesion";
import { listarBodegas, listarEmpresas, obtenerValoresPorDefecto } from "@/lib/empresas/consultar";
import { NuevaEmpresaForm } from "@/components/empresas/NuevaEmpresaForm";
import { FilaEmpresa } from "@/components/empresas/FilaEmpresa";
import { ConexionRelbase } from "@/components/empresas/ConexionRelbase";
import { obtenerEstadoConexion } from "@/lib/relbase/oauth";

export const dynamic = "force-dynamic";

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Los operadores pueden crear empresas; editarlas, activarlas y la conexion
  // con Relbase quedan para administradores.
  const usuario = await requerirUsuario();
  const esAdmin = usuario.rol === "admin";
  const params = await searchParams;

  // Sin await: las bodegas salen de Relbase (lento) y solo se usan al abrir
  // "Agregar empresa". La pantalla se muestra sin esperarlas.
  const bodegas = listarBodegas();
  const [empresas, valoresPorDefecto, conexion] = await Promise.all([
    listarEmpresas(),
    obtenerValoresPorDefecto(),
    // Ademas de mostrarse solo a admins, el estado de la conexion no se consulta para operadores.
    esAdmin ? obtenerEstadoConexion() : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Empresas</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Las empresas a las que se les generan guías. Agregar una nueva no requiere tocar el
            código: basta con su cliente en Relbase y su lista de códigos.
          </p>
        </div>
      </header>

      {esAdmin && (
        <ConexionRelbase
          conexion={conexion!}
          resultado={primerValor(params.relbase)}
          motivo={primerValor(params.motivo)}
        />
      )}

      <NuevaEmpresaForm valoresPorDefecto={valoresPorDefecto} bodegas={bodegas} />

      <ul className="flex flex-col gap-3">
        {empresas.map((empresa) => (
          <FilaEmpresa key={empresa.id} empresa={empresa} puedeEditar={esAdmin} />
        ))}
      </ul>

      {empresas.length === 0 && (
        <p className="text-sm text-ink-muted">Todavía no hay empresas configuradas.</p>
      )}
    </div>
  );
}
