/**
 * Lo que se ve mientras el servidor arma la pantalla. Sin esto, al hacer click
 * en el panel no pasaba nada visible hasta que la pagina llegaba entera, y
 * parecia que el click no habia funcionado.
 */
export default function CargandoPantalla() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6" aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <div className="flex flex-col gap-2">
        <div className="h-7 w-64 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded-lg bg-surface-muted" />
      </div>
      <div className="vidrio flex flex-col gap-3 p-5">
        <div className="h-4 w-40 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-surface-muted" />
      </div>
    </div>
  );
}
