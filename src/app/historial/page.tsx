import Link from "next/link";
import {
  obtenerHistorial,
  obtenerEmpresasConHistorial,
  SOLICITUDES_POR_PAGINA,
} from "@/lib/historial/consultar";
import { HistorialSolicitudes } from "@/components/historial/HistorialSolicitudes";
import { BuscadorHistorial } from "@/components/historial/BuscadorHistorial";

// Depende de datos en vivo y de los filtros de la URL: nunca estatica.
export const dynamic = "force-dynamic";

function primerValor(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const texto = primerValor(params.q);
  const empresa = primerValor(params.empresa);
  const desde = primerValor(params.desde);
  const hasta = primerValor(params.hasta);
  const pagina = Math.max(1, Number(primerValor(params.pagina)) || 1);

  const [{ solicitudes, totalSolicitudes, totalPaginas, hayFiltros }, empresas] = await Promise.all([
    obtenerHistorial({ texto, empresa, desde, hasta, pagina }),
    obtenerEmpresasConHistorial(),
  ]);

  // Se conservan los filtros al cambiar de pagina.
  const enlacePagina = (destino: number) => {
    const query = new URLSearchParams();
    if (texto) query.set("q", texto);
    if (empresa) query.set("empresa", empresa);
    if (desde) query.set("desde", desde);
    if (hasta) query.set("hasta", hasta);
    if (destino > 1) query.set("pagina", String(destino));
    const cadena = query.toString();
    return cadena ? `/historial?${cadena}` : "/historial";
  };

  const primeraDeLaPagina = (pagina - 1) * SOLICITUDES_POR_PAGINA + 1;
  const ultimaDeLaPagina = Math.min(pagina * SOLICITUDES_POR_PAGINA, totalSolicitudes);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-6 py-10">
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

      <BuscadorHistorial
        empresas={empresas}
        valores={{ texto, empresa, desde, hasta }}
        hayFiltros={hayFiltros}
      />

      {totalSolicitudes > 0 && (
        <p className="text-xs text-ink-muted">
          {hayFiltros ? "Coinciden " : "Hay "}
          <span className="font-medium text-ink">{totalSolicitudes}</span>{" "}
          {totalSolicitudes === 1 ? "solicitud" : "solicitudes"}
          {totalPaginas > 1 && ` · mostrando ${primeraDeLaPagina}–${ultimaDeLaPagina}`}
        </p>
      )}

      {solicitudes.length === 0 && hayFiltros ? (
        <div className="rounded-sm border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-ink-muted">
            Ninguna solicitud coincide con la búsqueda. Prueba con menos filtros o revisa el folio.
          </p>
        </div>
      ) : (
        <HistorialSolicitudes solicitudes={solicitudes} />
      )}

      {totalPaginas > 1 && (
        <nav className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
          {pagina > 1 ? (
            <Link href={enlacePagina(pagina - 1)} className="text-teal hover:underline">
              ← Más recientes
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Página {pagina} de {totalPaginas}
          </span>
          {pagina < totalPaginas ? (
            <Link href={enlacePagina(pagina + 1)} className="text-teal hover:underline">
              Más antiguas →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
