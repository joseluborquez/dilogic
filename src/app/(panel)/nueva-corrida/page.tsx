import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";
import { requerirUsuario } from "@/lib/auth/sesion";

// Las empresas se leen de la base en cada carga: agregar una nueva debe
// reflejarse aca sin volver a desplegar.
export const dynamic = "force-dynamic";

export default async function NuevaCorridaPage() {
  await requerirUsuario();
  const empresas = await listarEmpresasActivas();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Nueva corrida de guías de despacho</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sube el pedido ya depurado, revisa la validación por fila y genera las guías en Relbase.
        </p>
      </header>

      <NuevaCorridaForm empresas={empresas} />
    </div>
  );
}
