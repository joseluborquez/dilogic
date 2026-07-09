import Link from "next/link";
import { SincronizarCatalogoForm } from "@/components/catalogo/SincronizarCatalogoForm";

export default function CatalogoPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
        <h1 className="font-display text-2xl font-semibold">Catálogo de productos</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sincroniza el catálogo con Relbase para que la validación de pedidos use el precio y el
          ID de producto reales. Solo lectura hacia Relbase.
        </p>
      </header>

      <SincronizarCatalogoForm />

      <Link href="/nueva-corrida" className="text-sm text-teal hover:underline">
        ← Volver a nueva corrida
      </Link>
    </main>
  );
}
