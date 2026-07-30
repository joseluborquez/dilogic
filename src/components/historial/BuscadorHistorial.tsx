import Link from "next/link";

interface Props {
  empresas: { codigo: string; nombre: string }[];
  valores: { texto: string; empresa: string; desde: string; hasta: string };
  hayFiltros: boolean;
}

/**
 * Formulario GET puro: los filtros viven en la URL, asi que la busqueda se
 * puede compartir, marcar y recargar, y funciona sin JavaScript. La pagina se
 * vuelve a renderizar en el servidor con los filtros aplicados.
 */
export function BuscadorHistorial({ empresas, valores, hayFiltros }: Props) {
  return (
    <form
      method="get"
      action="/historial"
      className="flex flex-wrap items-end gap-3 rounded-sm border border-line bg-surface px-3 py-3"
    >
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label htmlFor="q" className="text-xs tracking-wide text-ink-muted uppercase">
          Folio o centro
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={valores.texto}
          placeholder="Ej: 39805 o MELCHOR"
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="empresa" className="text-xs tracking-wide text-ink-muted uppercase">
          Empresa
        </label>
        <select
          id="empresa"
          name="empresa"
          defaultValue={valores.empresa}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        >
          <option value="">Todas</option>
          {empresas.map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="desde" className="text-xs tracking-wide text-ink-muted uppercase">
          Desde
        </label>
        <input
          id="desde"
          name="desde"
          type="date"
          defaultValue={valores.desde}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="hasta" className="text-xs tracking-wide text-ink-muted uppercase">
          Hasta
        </label>
        <input
          id="hasta"
          name="hasta"
          type="date"
          defaultValue={valores.hasta}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong"
        >
          Buscar
        </button>
        {hayFiltros && (
          <Link href="/historial" className="text-sm text-ink-muted hover:underline">
            Limpiar
          </Link>
        )}
      </div>
    </form>
  );
}
