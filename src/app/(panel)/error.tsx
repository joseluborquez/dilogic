"use client";

import Link from "next/link";

/**
 * Reemplaza la pantalla tecnica de Next cuando algo falla dentro del panel.
 * Lo importante para quien opera: si estaba emitiendo, las guias pudieron
 * salir igual, asi que primero se revisa el Historial y recien despues se
 * reintenta. "Cargar de nuevo" solo vuelve a pedir la pantalla: no reenvia
 * ninguna emision.
 */
export default function ErrorPanel({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 py-10">
      <h1 className="font-display text-2xl font-semibold">Algo falló en esta pantalla</h1>
      <p className="text-sm text-ink-muted">
        Si estabas emitiendo guías, puede que igual hayan salido. Revisa el Historial antes de
        volver a intentarlo.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/historial"
          className="rounded-lg bg-teal px-5 py-2 font-display text-sm font-medium text-on-accent transition-colors hover:bg-teal-strong"
        >
          Ir al Historial
        </Link>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-lg px-4 py-2 text-sm text-teal hover:underline"
        >
          Cargar la pantalla de nuevo
        </button>
      </div>
      {error.digest && <p className="text-xs text-ink-muted">Código del error: {error.digest}</p>}
    </div>
  );
}
