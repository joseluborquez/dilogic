import { SincronizarCatalogoForm } from "@/components/catalogo/SincronizarCatalogoForm";
import { BotonVolver } from "@/components/ui/BotonVolver";

export default function CatalogoPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Catálogo de productos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Sincroniza el catálogo con Relbase para que la validación de pedidos use el precio y el
            ID de producto reales. Solo lectura hacia Relbase.
          </p>
        </div>
        <BotonVolver href="/nueva-corrida">Nueva corrida</BotonVolver>
      </header>

      <SincronizarCatalogoForm />
    </main>
  );
}
