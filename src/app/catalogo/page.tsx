import { SincronizarCatalogoForm } from "@/components/catalogo/SincronizarCatalogoForm";
import { BotonVolver } from "@/components/ui/BotonVolver";
import { requerirAdmin } from "@/lib/auth/sesion";
import { obtenerUltimaSincronizacion } from "@/lib/catalogo/sincronizar";
import { UltimaSincronizacion } from "@/components/catalogo/UltimaSincronizacion";

export const dynamic = "force-dynamic";

export default async function CatalogoPage() {
  await requerirAdmin();
  const ultima = await obtenerUltimaSincronizacion();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Catálogo de productos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Relbase manda: el catálogo toma de ahí precios y productos, agrega los códigos nuevos y
            bloquea los que ya no existen o están deshabilitados allá. Se sincroniza solo todos los
            días temprano; el botón sirve para hacerlo en el momento.
          </p>
        </div>
        <BotonVolver href="/nueva-corrida">Nueva corrida</BotonVolver>
      </header>

      <UltimaSincronizacion ultima={ultima} />

      <SincronizarCatalogoForm />
    </main>
  );
}
