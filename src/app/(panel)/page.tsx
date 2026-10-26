import { unstable_cache } from "next/cache";
import { requerirUsuario } from "@/lib/auth/sesion";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  FAMILIAS,
  NOMBRE_FAMILIA,
  NOMBRE_GRUPO,
  TAG_VENTAS,
  agregadoPeriodo,
  moverMes,
  nombreMes,
  nombreMesCorto,
  periodoDeComparacion,
  periodoDelMes,
  primeraFechaConVentas,
  totalesFiltrados,
  ultimosMeses,
  type AgregadoPeriodo,
  type GrupoEmpresa,
  type Periodo,
  type ProductoAgregado,
} from "@/lib/ventas/indicadores";
import { juntarMismoProducto, unidadDeVenta, type FilaTop, type ParteTop } from "@/lib/ventas/mismo-producto";
import { entero, numero, pesos, pesosCorto, textoVariacion, variacion } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { BarraFiltros, NavegacionVentas } from "@/components/inicio/Navegacion";
import { BarrasReparto, GraficoMeses, Ranking, nombreLegible, type FilaBarra } from "@/components/inicio/Graficos";

export const dynamic = "force-dynamic";

const MESES_EN_SELECTOR = 6;
const EMPRESAS_FILTRO: GrupoEmpresa[] = ["CERQ", "MTX", "YDR", "OTROS"];
/** Fuera de rankings, precios y menos vendidos (ver lib/ventas/indicadores.ts). */
const FUERA_DE_RANKINGS = new Set<GrupoEmpresa>(["AMS", "GENERICO"]);

const catalogoVigente = unstable_cache(
  async () => {
    const { data } = await getSupabaseServiceClient()
      .from("productos_catalogo")
      .select("sku, descripcion, nombre_relbase, familia")
      .eq("activo", true)
      .order("sku")
      .range(0, 4999);
    return (data ?? []).map((p) => ({
      codigo: p.sku,
      nombre: p.nombre_relbase ?? p.descripcion ?? p.sku,
      grupo: p.sku.split("_")[0] as GrupoEmpresa,
      familia: p.familia,
    }));
  },
  ["catalogo-vigente-v1"],
  { tags: [TAG_VENTAS], revalidate: 3600 },
);

function primerValor(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

const soloMes = (p: Periodo) => nombreMes(p.mes).split(" ")[0];

/** Para frases: "del 1 al 25 de octubre" / "en septiembre". */
function cuando(p: Periodo): string {
  return p.completo ? `en ${soloMes(p)}` : `del 1 al ${p.dia} de ${soloMes(p)}`;
}

/** Para comparar: "1 al 25 de septiembre" / "septiembre completo". */
function nombrePeriodo(p: Periodo): string {
  return p.completo ? `${soloMes(p)} completo` : `1 al ${p.dia} de ${soloMes(p)}`;
}

const mayuscula = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const usuario = await requerirUsuario();
  const params = await searchParams;

  const meses = ultimosMeses(MESES_EN_SELECTOR);
  const mes = meses.includes(primerValor(params.mes)) ? primerValor(params.mes) : meses[0];
  const empresa = EMPRESAS_FILTRO.includes(primerValor(params.empresa) as GrupoEmpresa)
    ? (primerValor(params.empresa) as GrupoEmpresa)
    : "";
  const familia = (FAMILIAS as readonly string[]).includes(primerValor(params.familia))
    ? primerValor(params.familia)
    : "";

  const actual = periodoDelMes(mes);
  const comparacion = periodoDeComparacion(actual);
  const anteriorCompleto = periodoDelMes(moverMes(mes, -1));

  const primeraFecha = await primeraFechaConVentas();
  const hayDatos = (p: Periodo) => primeraFecha != null && p.desde >= primeraFecha.slice(0, 8) + "01";
  const pedir = (p: Periodo) => (hayDatos(p) ? agregadoPeriodo(p.desde, p.hasta) : Promise.resolve(null));

  // El grafico muestra los meses del selector, del mas antiguo al mas reciente.
  const periodosGrafico = [...meses].reverse().map((m) => periodoDelMes(m));
  const [datos, datosComparacion, datosAnterior, catalogo, ...datosGrafico] = await Promise.all([
    pedir(actual),
    pedir(comparacion),
    pedir(anteriorCompleto),
    catalogoVigente(),
    ...periodosGrafico.map(pedir),
  ]);

  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams();
    const valores = { mes, empresa, familia, ...cambios };
    if (valores.mes && valores.mes !== meses[0]) q.set("mes", valores.mes);
    if (valores.empresa) q.set("empresa", valores.empresa);
    if (valores.familia) q.set("familia", valores.familia);
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };
  const nombre = usuario.nombre?.split(" ")[0];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{nombre ? `Hola, ${nombre}` : "Ventas"}</h1>
        <p className="text-sm text-ink-muted">Ventas con guías válidas en Relbase · montos netos, sin IVA</p>
      </header>

      <NavegacionVentas
        barra={
          <BarraFiltros
            limpiar={empresa || familia ? enlace({ empresa: "", familia: "" }) : null}
            filtros={[
              {
                nombre: "Mes",
                activo: mes,
                opciones: meses.map((m, i) => ({
                  valor: m,
                  etiqueta: `${mayuscula(nombreMes(m))}${i === 0 ? " (en curso)" : ""}`,
                })),
                hrefs: Object.fromEntries(meses.map((m) => [m, enlace({ mes: m })])),
              },
              {
                nombre: "Empresa",
                activo: empresa,
                opciones: [
                  { valor: "", etiqueta: "Todas las empresas" },
                  ...EMPRESAS_FILTRO.map((e) => ({ valor: e, etiqueta: NOMBRE_GRUPO[e] })),
                ],
                hrefs: Object.fromEntries(["", ...EMPRESAS_FILTRO].map((e) => [e, enlace({ empresa: e })])),
              },
              {
                nombre: "Familia",
                activo: familia,
                opciones: [
                  { valor: "", etiqueta: "Todas las familias" },
                  ...FAMILIAS.map((f) => ({ valor: f, etiqueta: NOMBRE_FAMILIA[f] })),
                ],
                hrefs: Object.fromEntries(["", ...FAMILIAS].map((f) => [f, enlace({ familia: f })])),
              },
            ]}
          />
        }
      >
        {!datos ? (
          <div className="vidrio p-5 text-sm text-ink-muted">Todavía no hay ventas cargadas para {nombreMes(mes)}.</div>
        ) : (
          <>
            <Resumen
              actual={actual}
              comparacion={comparacion}
              datos={datos}
              datosComparacion={datosComparacion}
              empresa={empresa}
              familia={familia}
            />

            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Bloque
                  titulo={`Monto neto por mes${textoFiltro(empresa, familia)}`}
                  comoLeer={
                    actual.enCurso || periodosGrafico.some((p) => p.enCurso)
                      ? "* = mes en curso. Toca un mes para verlo."
                      : "Toca un mes para verlo."
                  }
                >
                  <GraficoMeses
                    puntos={periodosGrafico.map((per, i) => {
                      const d = datosGrafico[i];
                      const t = d ? totalesFiltrados(d, empresa, familia) : null;
                      return {
                        clave: per.mes,
                        etiqueta: `${nombreMesCorto(per.mes)}${per.enCurso ? "*" : ""}`,
                        valor: t ? t.monto : null,
                        texto: t ? pesosCorto(t.monto) : "—",
                        detalle: `${mayuscula(nombreMes(per.mes))}${per.enCurso ? `, del 1 al ${per.dia}` : ""}: ${t ? pesos(t.monto) : "sin datos"}`,
                        href: enlace({ mes: per.mes }),
                        activo: per.mes === mes,
                      };
                    })}
                  />
                </Bloque>
              </div>
              <div className="flex flex-col gap-6 lg:col-span-2">
                <Reparto
                  titulo={`Por empresa${familia ? ` (${NOMBRE_FAMILIA[familia]})` : ""}`}
                  datos={datos}
                  datosComparacion={datosComparacion}
                  partes={EMPRESAS_FILTRO.map((g) => ({
                    clave: g,
                    etiqueta: NOMBRE_GRUPO[g],
                    href: enlace({ empresa: g === empresa ? "" : g }),
                  }))}
                  calza={(p, clave) => p.grupo === clave && (!familia || p.familia === familia)}
                  activo={empresa}
                />
                <Reparto
                  titulo={`Por familia${empresa ? ` (${NOMBRE_GRUPO[empresa]})` : ""}`}
                  datos={datos}
                  datosComparacion={datosComparacion}
                  partes={FAMILIAS.map((f) => ({
                    clave: f,
                    etiqueta: NOMBRE_FAMILIA[f],
                    href: enlace({ familia: f === familia ? "" : f }),
                  }))}
                  calza={(p, clave) => p.familia === clave && (!empresa || p.grupo === empresa)}
                  activo={familia}
                />
              </div>
            </div>

            <TopProductos datos={datos} empresa={empresa} familia={familia} />

            <h2 className="mt-4 font-display text-lg font-semibold text-ink-muted">Detalle en números</h2>
            <MasVendidos datos={datos} empresa={empresa} familia={familia} />
            <Precios datos={datos} anterior={datosAnterior} empresa={empresa} familia={familia} actual={actual} />
            <MenosVendidos datos={datos} catalogo={catalogo} empresa={empresa} familia={familia} />
          </>
        )}
      </NavegacionVentas>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Resumen({
  actual,
  comparacion,
  datos,
  datosComparacion,
  empresa,
  familia,
}: {
  actual: Periodo;
  comparacion: Periodo;
  datos: AgregadoPeriodo;
  datosComparacion: AgregadoPeriodo | null;
  empresa: string;
  familia: string;
}) {
  const t = totalesFiltrados(datos, empresa, familia);
  const c = datosComparacion ? totalesFiltrados(datosComparacion, empresa, familia) : null;
  const vMonto = c ? variacion(t.monto, c.monto) : null;
  const promedio = t.guias > 0 ? t.monto / t.guias : 0;
  const promedioC = c && c.guias > 0 ? c.monto / c.guias : null;
  const vs = `vs. ${soloMes(comparacion).slice(0, 3)}.`;
  const filtro = textoFiltro(empresa, familia);

  return (
    <section className="vidrio flex flex-col gap-4 p-5">
      <p className="font-display text-xl">
        {mayuscula(cuando(actual))}
        {filtro && <span className="text-teal">{filtro}</span>}
        {": "}
        <strong className="text-teal">{pesos(t.monto)}</strong>
        {vMonto != null && (
          <span className="text-base text-ink-muted">
            {" "}
            ·{" "}
            {Math.round(vMonto) === 0
              ? "igual que"
              : `${Math.abs(Math.round(vMonto))}% ${vMonto > 0 ? "más" : "menos"} que`}{" "}
            el {nombrePeriodo(comparacion)}
          </span>
        )}
      </p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Cifra titulo="Monto neto" valor={pesosCorto(t.monto)} cambio={vMonto} vs={vs} />
        <Cifra
          titulo="Guías"
          ayuda={empresa || familia ? "Guías válidas con al menos un producto del filtro" : "Guías válidas"}
          valor={entero(t.guias)}
          cambio={c ? variacion(t.guias, c.guias) : null}
          vs={vs}
        />
        <Cifra
          titulo="Promedio por guía"
          ayuda="Monto neto dividido por las guías"
          valor={pesosCorto(promedio)}
          cambio={promedioC ? variacion(promedio, promedioC) : null}
          vs={vs}
        />
        <Cifra
          titulo="No cuentan"
          ayuda="Anuladas en el SII y guías de transporte de bins, de todas las empresas: no son venta"
          valor={entero(datos.anuladas + datos.binsExcluidas)}
          nota={`${entero(datos.anuladas)} anuladas · ${entero(datos.binsExcluidas)} de bins`}
        />
      </dl>
    </section>
  );
}

function Cifra({
  titulo,
  valor,
  cambio,
  vs,
  nota,
  ayuda,
}: {
  titulo: string;
  valor: string;
  cambio?: number | null;
  vs?: string;
  nota?: string;
  ayuda?: string;
}) {
  const color =
    cambio == null || Math.round(cambio) === 0 ? "text-ink-muted" : cambio > 0 ? "text-valido" : "text-error";
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2" title={ayuda}>
      <dt className="text-xs text-ink-muted">{titulo}</dt>
      <dd className="font-mono text-xl font-semibold">{valor}</dd>
      {cambio != null && (
        <dd className="text-xs text-ink-muted">
          <span className={`font-mono font-medium ${color}`}>{textoVariacion(cambio)}</span> {vs}
        </dd>
      )}
      {nota && <dd className="text-xs text-ink-muted">{nota}</dd>}
    </div>
  );
}

function sumarMonto(a: AgregadoPeriodo | null, calza: (p: ProductoAgregado) => boolean): number | null {
  if (!a) return null;
  return a.productos.reduce((s, p) => (calza(p) ? s + p.monto : s), 0);
}

/** Barras de monto por empresa o por familia; tocar una barra filtra por ella. */
function Reparto({
  titulo,
  datos,
  datosComparacion,
  partes,
  calza,
  activo,
}: {
  titulo: string;
  datos: AgregadoPeriodo;
  datosComparacion: AgregadoPeriodo | null;
  partes: { clave: string; etiqueta: string; href: string }[];
  calza: (p: ProductoAgregado, clave: string) => boolean;
  activo: string;
}) {
  const filas: FilaBarra[] = partes.map((x) => {
    const monto = sumarMonto(datos, (p) => calza(p, x.clave)) ?? 0;
    const antes = sumarMonto(datosComparacion, (p) => calza(p, x.clave));
    return {
      clave: x.clave,
      etiqueta: x.etiqueta,
      valor: monto,
      texto: pesosCorto(monto),
      cambio: antes != null ? variacion(monto, antes) : null,
      detalle: `${x.etiqueta}: ${pesos(monto)}`,
      href: x.href,
      activo: x.clave === activo,
    };
  });
  return (
    <Bloque titulo={titulo} comoLeer="Toca una barra para filtrar.">
      <BarrasReparto filas={filas} hayActivo={Boolean(activo)} />
    </Bloque>
  );
}

/** Los 10 productos con mas monto, sumando el mismo producto de las tres empresas. */
function TopProductos({ datos, empresa, familia }: { datos: AgregadoPeriodo; empresa: string; familia: string }) {
  const filas = juntarMismoProducto(filtrar(datos.productos, empresa, familia))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 10);
  return (
    <Bloque
      titulo={`Los 10 que más venden${textoFiltro(empresa, familia)}`}
      comoLeer="Por monto neto. El mismo producto de varias empresas va sumado."
    >
      {filas.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay ventas con estos filtros.</p>
      ) : (
        <Ranking
          filas={filas.map((f) => ({
            clave: f.clave,
            etiqueta: f.nombre,
            nota: `${numero(f.cantidad)} ${f.unidad} · ${f.partes
              .map((x) => NOMBRE_GRUPO[x.producto.grupo])
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(", ")}`,
            valor: f.monto,
            texto: pesos(f.monto),
            detalle: f.partes.map((x) => `${NOMBRE_GRUPO[x.producto.grupo]}: ${pesos(x.producto.monto)}`).join(" · "),
          }))}
        />
      )}
    </Bloque>
  );
}

function filtrar(productos: ProductoAgregado[], empresa: string, familia: string) {
  return productos.filter(
    (p) => !FUERA_DE_RANKINGS.has(p.grupo) && (!empresa || p.grupo === empresa) && (!familia || p.familia === familia),
  );
}

function textoFiltro(empresa: string, familia: string): string {
  const partes = [empresa && NOMBRE_GRUPO[empresa as GrupoEmpresa], familia && NOMBRE_FAMILIA[familia]].filter(Boolean);
  return partes.length ? ` (${partes.join(", ")})` : "";
}

const TH = "px-3 py-2 text-left text-xs font-medium tracking-wide text-ink-muted uppercase";
const TD = "px-3 py-2 align-top";

function MasVendidos({ datos, empresa, familia }: { datos: AgregadoPeriodo; empresa: string; familia: string }) {
  const filas = juntarMismoProducto(filtrar(datos.productos, empresa, familia));
  const porCantidad = [...filas].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
  const porMonto = [...filas].sort((a, b) => b.monto - a.monto).slice(0, 10);

  return (
    <Bloque
      titulo={`Más vendidos${textoFiltro(empresa, familia)}`}
      comoLeer={
        empresa
          ? "Top 10 por cantidad y por monto neto."
          : "Top 10 por cantidad y por monto neto. El mismo producto de varias empresas va sumado, convertido a un mismo formato."
      }
    >
      {filas.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay ventas con estos filtros.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <TablaTop titulo="Por cantidad" filas={porCantidad} etiqueta="Cantidad" modo="cantidad" />
          <TablaTop titulo="Por monto" filas={porMonto} etiqueta="Monto neto" modo="monto" />
        </div>
      )}
    </Bloque>
  );
}

function TablaTop({
  titulo,
  filas,
  etiqueta,
  modo,
}: {
  titulo: string;
  filas: FilaTop[];
  etiqueta: string;
  modo: "cantidad" | "monto";
}) {
  const repetida = (f: FilaTop, grupo: GrupoEmpresa) => f.partes.filter((x) => x.producto.grupo === grupo).length > 1;
  const detalle = (f: FilaTop, x: ParteTop) => {
    const quien = repetida(f, x.producto.grupo) ? x.producto.codigo : NOMBRE_GRUPO[x.producto.grupo];
    if (modo === "monto") return `${quien} ${pesos(x.producto.monto)}`;
    const convertido = Math.abs(x.equivalente - x.producto.cantidad) > 1e-6;
    return `${quien} ${numero(x.equivalente)}${convertido ? ` (${numero(x.producto.cantidad)} ${x.unidad})` : ""}`;
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{titulo}</h3>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-muted">
              <th className={TH}>#</th>
              <th className={TH}>Producto</th>
              <th className={`${TH} text-right`}>{etiqueta}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.clave} className="border-b border-line last:border-0 even:bg-surface-muted">
                <td className={`${TD} font-mono text-ink-muted`}>{i + 1}</td>
                <td className={TD}>
                  <span className="block">{nombreLegible(f.nombre)}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {f.partes.length > 1
                      ? f.partes.map((x) => detalle(f, x)).join(" · ")
                      : `${f.partes[0].producto.codigo} · ${NOMBRE_GRUPO[f.partes[0].producto.grupo]}`}
                  </span>
                </td>
                <td className={`${TD} text-right font-mono whitespace-nowrap`}>
                  {modo === "monto" ? (
                    pesos(f.monto)
                  ) : (
                    <>
                      {numero(f.cantidad)} <span className="text-xs text-ink-muted">{f.unidad}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MENOS_VENDIDOS_A_MOSTRAR = 20;

function MenosVendidos({
  datos,
  catalogo,
  empresa,
  familia,
}: {
  datos: AgregadoPeriodo;
  catalogo: {
    codigo: string;
    nombre: string;
    grupo: GrupoEmpresa;
    familia: string | null;
  }[];
  empresa: string;
  familia: string;
}) {
  const vendido = new Map(datos.productos.map((p) => [p.codigo, p.cantidad]));
  const vigentes = catalogo
    .filter((p) => (!empresa || p.grupo === empresa) && (!familia || p.familia === familia))
    .map((p) => ({ ...p, cantidad: vendido.get(p.codigo) ?? 0 }))
    .sort((a, b) => a.cantidad - b.cantidad || a.codigo.localeCompare(b.codigo));
  const sinVenta = vigentes.filter((p) => p.cantidad === 0).length;

  return (
    <Bloque
      titulo={`Menos vendidos${textoFiltro(empresa, familia)}`}
      comoLeer={`Los ${MENOS_VENDIDOS_A_MOSTRAR} productos vigentes con menos despacho. 0 = no salió en ninguna guía.`}
    >
      {empresa === "OTROS" ? (
        <p className="text-sm text-ink-muted">
          «Otros» no tiene catálogo propio en la app: elige Cermaq, Multiexport o Yadran.
        </p>
      ) : (
        <>
          <p className="text-sm">
            <strong className="font-mono">{entero(sinVenta)}</strong> de {entero(vigentes.length)} productos vigentes no
            se vendieron en el período.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted">
                  <th className={TH}>Producto</th>
                  <th className={TH}>Empresa</th>
                  <th className={`${TH} text-right`}>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {vigentes.slice(0, MENOS_VENDIDOS_A_MOSTRAR).map((p) => (
                  <tr key={p.codigo} className="border-b border-line last:border-0 even:bg-surface-muted">
                    <td className={TD}>
                      <span className="block">{p.nombre}</span>
                      <span className="font-mono text-xs text-ink-muted">{p.codigo}</span>
                    </td>
                    <td className={TD}>{NOMBRE_GRUPO[p.grupo] ?? p.grupo}</td>
                    <td className={`${TD} text-right font-mono`}>
                      {numero(p.cantidad)}{" "}
                      <span className="text-xs text-ink-muted">{unidadDeVenta(p.nombre, p.cantidad)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Bloque>
  );
}

interface FilaPrecio extends ProductoAgregado {
  antes: number | null;
}

function TablaPrecios({
  filas,
  conAntes,
  mesAnterior,
}: {
  filas: FilaPrecio[];
  conAntes: boolean;
  mesAnterior: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-muted">
            <th className={TH}>Producto</th>
            <th className={TH}>Empresa</th>
            {conAntes && <th className={`${TH} text-right`}>Precio en {mesAnterior}</th>}
            <th className={`${TH} text-right`}>Precio actual</th>
            {conAntes && <th className={`${TH} text-right`}>Cambio</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.codigo} className="border-b border-line last:border-0 even:bg-surface-muted">
              <td className={TD}>
                <span className="block">{p.nombre}</span>
                <span className="font-mono text-xs text-ink-muted">{p.codigo}</span>
              </td>
              <td className={TD}>{NOMBRE_GRUPO[p.grupo]}</td>
              {conAntes && <td className={`${TD} text-right font-mono`}>{p.antes != null ? pesos(p.antes) : "—"}</td>}
              <td className={`${TD} text-right font-mono`}>{pesos(p.ultimoPrecio!)}</td>
              {conAntes && (
                <td className={`${TD} text-right font-mono`}>
                  {p.antes != null ? textoVariacion(variacion(p.ultimoPrecio!, p.antes)) : "nuevo"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Precios({
  datos,
  anterior,
  empresa,
  familia,
  actual,
}: {
  datos: AgregadoPeriodo;
  anterior: AgregadoPeriodo | null;
  empresa: string;
  familia: string;
  actual: Periodo;
}) {
  const previo = new Map((anterior?.productos ?? []).map((p) => [p.codigo, p.ultimoPrecio]));
  const conPrecio = filtrar(datos.productos, empresa, familia)
    .filter((p) => p.ultimoPrecio != null)
    .map((p) => ({ ...p, antes: previo.get(p.codigo) ?? null }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nombre.localeCompare(b.nombre));
  const cambios = conPrecio
    .filter((p) => p.antes != null && p.antes !== p.ultimoPrecio)
    .map((p) => ({ ...p, v: variacion(p.ultimoPrecio!, p.antes!) ?? 0 }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const mesAnterior = nombreMes(moverMes(actual.mes, -1)).split(" ")[0];

  return (
    <Bloque
      titulo={`Precios${textoFiltro(empresa, familia)}`}
      comoLeer={`Último precio cobrado vs. ${mesAnterior}; solo los que cambiaron.`}
    >
      {cambios.length === 0 ? (
        <p className="text-sm text-ink-muted">Ningún producto cambió de precio respecto de {mesAnterior}.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong className="font-mono">{entero(cambios.length)}</strong> productos cambiaron de precio:{" "}
            {entero(cambios.filter((c) => c.v > 0).length)} subieron y {entero(cambios.filter((c) => c.v < 0).length)}{" "}
            bajaron.
          </p>
          <TablaPrecios filas={cambios} conAntes mesAnterior={mesAnterior} />
        </>
      )}
      <details className="group">
        <summary className="cursor-pointer text-sm text-teal hover:underline">
          Ver el precio actual de los {entero(conPrecio.length)} productos vendidos
        </summary>
        <div className="mt-3">
          <TablaPrecios filas={conPrecio} conAntes={false} mesAnterior={mesAnterior} />
        </div>
      </details>
    </Bloque>
  );
}
