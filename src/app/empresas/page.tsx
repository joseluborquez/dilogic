import { BotonVolver } from "@/components/ui/BotonVolver";
import { requerirAdmin } from "@/lib/auth/sesion";
import { listarBodegas, listarEmpresas, obtenerValoresPorDefecto } from "@/lib/empresas/consultar";
import { NuevaEmpresaForm } from "@/components/empresas/NuevaEmpresaForm";
import { FilaEmpresa } from "@/components/empresas/FilaEmpresa";

export const dynamic = "force-dynamic";

export default async function EmpresasPage() {
  await requerirAdmin();

  const [empresas, valoresPorDefecto, bodegas] = await Promise.all([
    listarEmpresas(),
    obtenerValoresPorDefecto(),
    listarBodegas(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Empresas</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Las empresas a las que se les generan guías. Agregar una nueva no requiere tocar el
            código: basta con su cliente en Relbase y su lista de códigos.
          </p>
        </div>
        <BotonVolver href="/nueva-corrida">Nueva corrida</BotonVolver>
      </header>

      <NuevaEmpresaForm valoresPorDefecto={valoresPorDefecto} bodegas={bodegas} />

      <ul className="flex flex-col gap-3">
        {empresas.map((empresa) => (
          <FilaEmpresa key={empresa.id} empresa={empresa} />
        ))}
      </ul>

      {empresas.length === 0 && (
        <p className="text-sm text-ink-muted">Todavía no hay empresas configuradas.</p>
      )}
    </main>
  );
}
