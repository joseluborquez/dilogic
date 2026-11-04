import { requerirUsuario } from "@/lib/auth/sesion";
import {
  EMPRESAS_REPORTE,
  NOMBRE_EMPRESA_REPORTE,
  enRango,
  guiasDeEmpresa,
  rango,
  type EmpresaReporte,
  type GuiaReporte,
} from "@/lib/reportes/datos";
import { fechaTexto } from "@/lib/reportes/excel";
import { hoyChile, moverMes } from "@/lib/ventas/indicadores";
import { entero, pesos } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { EnlaceVentas, NavegacionVentas } from "@/components/inicio/Navegacion";
import { Calendario } from "@/components/reportes/Calendario";

export const dynamic = "force-dynamic";

/** Meses hacia atras que muestra el calendario. */
const MESES_ATRAS = 6;

type Params = { [key: string]: string | string[] | undefined };
const valor = (p: Params, k: string) => ((Array.isArray(p[k]) ? p[k]![0] : p[k]) as string | undefined)?.trim() ?? "";

export default async function ReportesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const empresa = (EMPRESAS_REPORTE as readonly string[]).includes(valor(params, "empresa"))
    ? (valor(params, "empresa") as EmpresaReporte)
    : "CERQ";

  const [, guias] = await Promise.all([
    requerirUsuario(),
    guiasDeEmpresa(empresa, `${moverMes(hoyChile().slice(0, 7), -MESES_ATRAS)}-01`),
  ]);

  const desde = valor(params, "desde");
  const hasta = valor(params, "hasta");
  const periodo = rango(desde, hasta);

  /** href con la empresa y el periodo dados ("" borra). */
  const enlace = (d: string, h: string) => {
    const q = new URLSearchParams();
    if (empresa !== "CERQ") q.set("empresa", empresa);
    if (d) q.set("desde", d);
    if (h) q.set("hasta", h);
    const s = q.toString();
    return s ? `/reportes?${s}` : "/reportes";
  };

  const dias: Record<string, number> = {};
  for (const g of guias) dias[g.fecha] = (dias[g.fecha] ?? 0) + 1;
  const delPeriodo = guias.filter((g) => enRango(g.fecha, periodo));
  // Cermaq: el mismo periodo para ambas zonas, mostradas por separado como en su Excel.
  const partes: { titulo: string | null; guias: GuiaReporte[] }[] =
    empresa === "CERQ"
      ? [
          { titulo: "Zona sur", guias: delPeriodo.filter((g) => g.zona === "SUR") },
          { titulo: "Zona norte", guias: delPeriodo.filter((g) => g.zona === "NORTE") },
        ]
      : [{ titulo: null, guias: delPeriodo }];
  const descarga = periodo ? `/api/reportes?${new URLSearchParams({ empresa, ...periodo })}` : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <NavegacionVentas
        barra={
          <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h1 className="font-display text-3xl font-semibold">Reportes</h1>
            <nav aria-label="Empresa" className="flex items-baseline gap-4 text-sm">
              {EMPRESAS_REPORTE.map((e) => (
                <EnlaceVentas
                  key={e}
                  href={e === "CERQ" ? "/reportes" : `/reportes?empresa=${e}`}
                  activo={e === empresa}
                  className={`rounded-sm transition-colors ${e === empresa ? "font-semibold text-ink" : "text-ink-muted hover:text-teal"}`}
                >
                  {NOMBRE_EMPRESA_REPORTE[e]}
                </EnlaceVentas>
              ))}
            </nav>
          </header>
        }
      >
        <Bloque titulo="Período" comoLeer="Toca el primer y el último día de despacho. Las guías de hoy aparecen mañana.">
          <Calendario dias={dias} desde={desde} hasta={hasta} plantilla={enlace("__D__", "__H__")} />
          {periodo && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-sm">
                  <span className="font-medium">
                    {fechaTexto(periodo.desde)} al {fechaTexto(periodo.hasta)}
                  </span>
                  <span className="text-ink-muted">
                    {" "}· {entero(delPeriodo.length)} {delPeriodo.length === 1 ? "guía" : "guías"}
                  </span>
                </p>
                <div className="flex items-baseline gap-4">
                  <EnlaceVentas href={enlace("", "")} className="text-sm text-ink-muted hover:text-teal">
                    Limpiar
                  </EnlaceVentas>
                  <span className="font-display text-2xl font-semibold tabular-nums">{pesos(delPeriodo.reduce((s, g) => s + g.neto, 0))}</span>
                </div>
              </div>
              <div className={`grid gap-6 ${partes.length > 1 ? "lg:grid-cols-2" : ""}`}>
                {partes.map((p) => (
                  <Centros key={p.titulo ?? "todas"} titulo={p.titulo} guias={p.guias} />
                ))}
              </div>
            </div>
          )}
        </Bloque>

        {descarga && (
          <div className="flex justify-end">
            <a
              href={descarga}
              className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-teal-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              Descargar Excel
            </a>
          </div>
        )}
      </NavegacionVentas>
    </div>
  );
}

/** Centros del periodo con sus guias; tocar un centro despliega sus guias. */
function Centros({ titulo, guias }: { titulo: string | null; guias: GuiaReporte[] }) {
  const centros = [...new Set(guias.map((g) => g.centro))].sort((a, b) => a.localeCompare(b, "es"));
  return (
    <div className="flex flex-col gap-2">
      {titulo && (
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{titulo}</span>
          <span className="tabular-nums text-ink-muted">{pesos(guias.reduce((s, g) => s + g.neto, 0))}</span>
        </p>
      )}
      {centros.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin guías en el período.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {centros.map((c) => {
            const lista = guias.filter((g) => g.centro === c).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio - b.folio);
            return (
              <li key={c}>
                <details className="group">
                  <summary className="flex cursor-pointer items-baseline gap-3 px-3 py-2 hover:bg-surface-muted">
                    <span className="flex-1">{c}</span>
                    <span className="text-xs text-ink-muted">{lista.length} {lista.length === 1 ? "guía" : "guías"}</span>
                    <span className="w-32 text-right tabular-nums">{pesos(lista.reduce((s, g) => s + g.neto, 0))}</span>
                  </summary>
                  <table className="mb-2 w-full text-xs">
                    <tbody>
                      {lista.map((g) => (
                        <tr key={g.dteId} className="text-ink-muted">
                          <td className="py-1 pl-6">Nº {g.folio}</td>
                          <td className="py-1">{fechaTexto(g.fecha)}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{pesos(g.neto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
