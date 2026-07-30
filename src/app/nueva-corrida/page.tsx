import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { EnlaceSeccion } from "@/components/ui/EnlaceSeccion";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";

// Las empresas se leen de la base en cada carga: agregar una nueva debe
// reflejarse aca sin volver a desplegar.
export const dynamic = "force-dynamic";

export default async function NuevaCorridaPage() {
  const empresas = await listarEmpresasActivas();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
        <h1 className="font-display text-2xl font-semibold">Nueva corrida de guías de despacho</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sube el pedido ya depurado, revisa la validación por fila y genera las guías en Relbase.
        </p>
      </header>

      {/* Las otras secciones, en fila: apiladas en la esquina competian con el
          titulo y no se leian como algo en que se pueda hacer clic. */}
      <nav aria-label="Secciones" className="flex flex-col gap-2 sm:flex-row">
        <EnlaceSeccion
          href="/historial"
          titulo="Historial"
          descripcion="Guías ya generadas, con sus PDF"
        />
        <EnlaceSeccion
          href="/catalogo"
          titulo="Catálogo"
          descripcion="Sincronizar códigos con Relbase"
        />
        <EnlaceSeccion href="/empresas" titulo="Empresas" descripcion="Clientes y sus códigos" />
      </nav>

      <NuevaCorridaForm empresas={empresas} />
    </main>
  );
}
