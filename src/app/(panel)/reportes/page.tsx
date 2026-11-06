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
import {
  FAMILIAS,
  NOMBRE_FAMILIA,
  hoyChile,
  moverMes,
  nombreMes,
  nombreMesCorto,
  periodoDelMes,
  ultimosMeses,
} from "@/lib/ventas/indicadores";
import { crearPedidorDeVentas } from "@/lib/ventas/con-hoy";
import { entero, pesos, pesosCorto } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { EnlaceVentas, NavegacionVentas, SelectorMes } from "@/components/inicio/Navegacion";
import { GraficoMeses, type BarraMes } from "@/components/inicio/Graficos";
import { Calendario } from "@/components/reportes/Calendario";
import { MasVendidos, MenosVendidos, Precios, catalogoVigente } from "@/components/ventas/Detalle";

export const dynamic = "force-dynamic";

/** Meses hacia atras que muestra el calendario. */
const MESES_ATRAS = 6;
/** Meses del grafico y del selector de mes del detalle de ventas. */
const MESES_EN_SELECTOR = 6;

const mayuscula = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
const FAMILIA_CORTA: Record<string, string> = { AB: "Abarrotes", CC: "Carnes y cong.", FV: "Frutas y verduras", AS: "Aseo" };

type Params = { [key: string]: string | string[] | undefined };
const valor = (p: Params, k: string) => ((Array.isArray(p[k]) ? p[k]![0] : p[k]) as string | undefined)?.trim() ?? "";

export default async function ReportesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const empresa = (EMPRESAS_REPORTE as readonly string[]).includes(valor(params, "empresa"))
    ? (valor(params, "empresa") as EmpresaReporte)
    : "CERQ";

  // Detalle de ventas (antes en «Más detalle» del inicio), de la empresa elegida.
  const meses = ultimosMeses(MESES_EN_SELECTOR);
  const mes = meses.includes(valor(params, "mes")) ? valor(params, "mes") : meses[0];
  const familia = (FAMILIAS as readonly string[]).includes(valor(params, "familia")) ? valor(params, "familia") : "";
  const actual = periodoDelMes(mes);
  const periodosGrafico = [...meses].reverse().map((m) => periodoDelMes(m));

  const [, { guias, sinHoy }, pedir, catalogo] = await Promise.all([
    requerirUsuario(),
    guiasDeEmpresa(empresa, `${moverMes(hoyChile().slice(0, 7), -MESES_ATRAS)}-01`),
    crearPedidorDeVentas(),
    catalogoVigente(),
  ]);
  const [datos, datosAnterior, ...datosGrafico] = await Promise.all([
    pedir(actual),
    pedir(periodoDelMes(moverMes(mes, -1))),
    ...periodosGrafico.map(pedir),
  ]);

  const desde = valor(params, "desde");
  const hasta = valor(params, "hasta");
  const periodo = rango(desde, hasta);

  /** href con la empresa, el periodo, el mes y la familia dados ("" borra). */
  const enlaceCon = (c: { d?: string; h?: string; mes?: string; familia?: string }) => {
    const v = { d: desde, h: hasta, mes, familia, ...c };
    const q = new URLSearchParams();
    if (empresa !== "CERQ") q.set("empresa", empresa);
    if (v.d) q.set("desde", v.d);
    if (v.h) q.set("hasta", v.h);
    if (v.mes && v.mes !== meses[0]) q.set("mes", v.mes);
    if (v.familia) q.set("familia", v.familia);
    const s = q.toString();
    return s ? `/reportes?${s}` : "/reportes";
  };
  const enlace = (d: string, h: string) => enlaceCon({ d, h });

  const montoEmpresa = (a: typeof datos) => (a ? (a.porCliente[empresa]?.monto ?? 0) : null);
  const mesesGrafico: BarraMes[] = periodosGrafico.map((per, i) => {
    const m = montoEmpresa(datosGrafico[i]);
    return {
      clave: per.mes,
      etiqueta: `${nombreMesCorto(per.mes)}${per.enCurso ? "*" : ""}`,
      valor: m,
      texto: m != null ? pesosCorto(m) : "—",
      detalle: `${mayuscula(nombreMes(per.mes))}${per.enCurso ? `, del 1 al ${per.dia}` : ""}: ${m != null ? pesos(m) : "sin datos"}`,
      href: enlaceCon({ mes: per.mes }),
      activo: per.mes === mes,
    };
  });

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
        <Bloque titulo="Período" comoLeer="Toca el primer y el último día de despacho. Las guías de hoy aparecen a los pocos minutos de emitirlas.">
          {sinHoy && (
            <p role="status" className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm">
              Relbase no respondió: pueden faltar las guías emitidas hoy. Recarga la página en unos minutos.
            </p>
          )}
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

        <header className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-display text-2xl font-semibold">
            Ventas de {NOMBRE_EMPRESA_REPORTE[empresa]} en {nombreMes(mes).split(" ")[0]}
          </h2>
          <SelectorMes
            meses={[...meses].reverse().map((m) => ({
              valor: m,
              etiqueta: nombreMesCorto(m),
              nombre: mayuscula(nombreMes(m)),
              href: enlaceCon({ mes: m }),
            }))}
            activo={mes}
          />
        </header>
        <nav aria-label="Familia" className="flex flex-wrap items-baseline gap-4 text-sm">
          {["", ...FAMILIAS].map((f) => (
            <EnlaceVentas
              key={f || "todas"}
              href={enlaceCon({ familia: f })}
              activo={familia === f}
              className={`rounded-sm transition-colors ${familia === f ? "font-semibold text-ink" : "text-ink-muted hover:text-teal"}`}
            >
              {f ? (FAMILIA_CORTA[f] ?? NOMBRE_FAMILIA[f]) : "Todas las familias"}
            </EnlaceVentas>
          ))}
        </nav>
        <Bloque titulo="Comparación con meses anteriores" comoLeer="Total de cada mes · * = mes en curso">
          <GraficoMeses puntos={mesesGrafico} />
        </Bloque>
        {!datos ? (
          <div className="vidrio p-6 text-sm text-ink-muted">Todavía no hay ventas cargadas para {nombreMes(mes)}.</div>
        ) : (
          <>
            <MasVendidos datos={datos} empresa={empresa} familia={familia} />
            <Precios datos={datos} anterior={datosAnterior} empresa={empresa} familia={familia} actual={actual} />
            <MenosVendidos datos={datos} catalogo={catalogo} empresa={empresa} familia={familia} />
          </>
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
