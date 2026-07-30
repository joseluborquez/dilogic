import Link from "next/link";
import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";

// Las empresas se leen de la base en cada carga: agregar una nueva debe
// reflejarse aca sin volver a desplegar.
export const dynamic = "force-dynamic";

export default async function NuevaCorridaPage() {
  const empresas = await listarEmpresasActivas();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Nueva corrida de guías de despacho</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Sube el pedido ya depurado, revisa la validación por fila y genera las guías en Relbase.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          <Link href="/historial" className="text-teal hover:underline">
            Historial de guías →
          </Link>
          <Link href="/catalogo" className="text-teal hover:underline">
            Sincronizar catálogo →
          </Link>
          <Link href="/empresas" className="text-teal hover:underline">
            Empresas cliente →
          </Link>
        </div>
      </header>

      <NuevaCorridaForm empresas={empresas} />
    </main>
  );
}
