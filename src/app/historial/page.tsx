import Link from "next/link";
import { obtenerHistorial, MAX_SOLICITUDES } from "@/lib/historial/consultar";
import { HistorialSolicitudes } from "@/components/historial/HistorialSolicitudes";

// Depende de datos en vivo (guias generadas + URLs firmadas con expiracion
// corta): no debe quedar cacheado como pagina estatica.
export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const solicitudes = await obtenerHistorial();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
          <h1 className="font-display text-2xl font-semibold">Historial de guías</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Cada bloque es una solicitud: el archivo que se subió y las guías que salieron de él.
            Selecciona guías para descargarlas en un ZIP o sacarlas del historial.
          </p>
        </div>
        <Link href="/nueva-corrida" className="shrink-0 text-sm text-teal hover:underline">
          ← Nueva corrida
        </Link>
      </header>

      <HistorialSolicitudes solicitudes={solicitudes} />

      {solicitudes.length >= MAX_SOLICITUDES && (
        <p className="text-xs text-ink-muted">
          Se muestran las últimas {MAX_SOLICITUDES} solicitudes.
        </p>
      )}
    </main>
  );
}
