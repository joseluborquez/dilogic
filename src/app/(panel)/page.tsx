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
  ultimosMeses,
  type AgregadoPeriodo,
  type GrupoEmpresa,
  type Periodo,
  type ProductoAgregado,
} from "@/lib/ventas/indicadores";
import { juntarMismoProducto, unidadDeVenta, type FilaTop, type ParteTop } from "@/lib/ventas/mismo-producto";
import { entero, numero, pesos, pesosCorto, textoVariacion, variacion } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";
import { BarraFiltros, EnlaceVentas, NavegacionVentas } from "@/components/inicio/Navegacion";
import { BarrasReparto, GraficoMeses, nombreLegible, type BarraMes } from "@/components/inicio/Graficos";

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
  const [empresasCorrida, datos, datosComparacion, datosAnterior, catalogo, ...datosGrafico] = await Promise.all([
    listarEmpresasActivas(),
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
  const mesesGrafico: BarraMes[] = periodosGrafico.map((per, i) => {
                const d = datosGrafico[i];
                return {
                  clave: per.mes,
                  etiqueta: `${nombreMesCorto(per.mes)}${per.enCurso ? "*" : ""}`,
                  valor: d ? d.monto : null,
                  texto: d ? pesosCorto(d.monto) : "—",
                  detalle: `${mayuscula(nombreMes(per.mes))}${per.enCurso ? `, del 1 al ${per.dia}` : ""}: ${d ? pesos(d.monto) : "sin datos"}`,
                  href: enlace({ mes: per.mes }),
                  activo: per.mes === mes,
                };
              });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <NavegacionVentas
        barra={
          <div className="flex flex-wrap items-end justify-between gap-3">
            <header className="flex flex-col gap-1">
              <h1 className="font-display text-2xl font-semibold">{nombre ? `Hola, ${nombre}` : "Ventas"}</h1>
              <p className="text-sm text-ink-muted">Montos netos, sin IVA</p>
            </header>
            <BarraFiltros
              compacta
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
              ]}
            />
          </div>
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
              familia={familia}
              hrefFamilia={(f) => enlace({ familia: f === familia ? "" : f })}
            />

            <Empresas
              datos={datos}
              datosComparacion={datosComparacion}
              activa={empresa}
              href={(g) => enlace({ empresa: g === empresa ? "" : g })}
            />

            {empresa && <Centros datos={datos} empresa={empresa as GrupoEmpresa} />}

            <details className="group flex flex-col gap-6">
              <summary className="cursor-pointer text-sm text-ink-muted hover:text-teal">Más detalle: meses anteriores, cantidades, precios y menos vendidos</summary>
              <div className="mt-6 flex flex-col gap-6">
                <Bloque titulo="Comparación con meses anteriores" comoLeer="Total de cada mes · * = mes en curso">
                  <GraficoMeses puntos={mesesGrafico} />
                </Bloque>
                <MasVendidos datos={datos} empresa={empresa} familia={familia} />
                <Precios datos={datos} anterior={datosAnterior} empresa={empresa} familia={familia} actual={actual} />
                <MenosVendidos datos={datos} catalogo={catalogo} empresa={empresa} familia={familia} />
              </div>
            </details>
          </>
        )}
      </NavegacionVentas>

      {/* Fuera de NavegacionVentas: cambiar de mes no atenua ni reinicia una corrida a medio validar. */}
      <section id="nueva-corrida" className="flex scroll-mt-6 flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">Crear guías automáticas</h2>
          <p className="text-sm text-ink-muted">
            Sube el pedido ya depurado, revisa la validación por fila y genera las guías en Relbase.
          </p>
        </header>
        <NuevaCorridaForm empresas={empresasCorrida} />
      </section>
    </div>
  );
}

/** Una tarjeta por empresa: monto, peso en el total y cambio. Tocarla despliega sus centros. */
function Empresas({
  datos,
  datosComparacion,
  activa,
  href,
}: {
  datos: AgregadoPeriodo;
  datosComparacion: AgregadoPeriodo | null;
  activa: string;
  href: (g: GrupoEmpresa) => string;
}) {
  const total = datos.monto || 1;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {EMPRESAS_FILTRO.map((g, i) => {
        // Por cliente de la guia: la tarjeta cuadra con la suma de sus centros.
        const monto = datos.porCliente[g]?.monto ?? 0;
        const antes = datosComparacion ? (datosComparacion.porCliente?.[g]?.monto ?? 0) : null;
        const cambio = antes ? variacion(monto, antes) : null;
        const centros = Object.keys(datos.porCentro[g] ?? {}).length;
        const esActiva = activa === g;
        return (
          <EnlaceVentas
            key={g}
            href={href(g)}
            activo={esActiva}
            className={`vidrio animar-subir elevar retraso-${i + 1} flex flex-col gap-1 p-4 hover:border-teal ${esActiva ? "border-teal ring-1 ring-teal" : ""}`}
          >
            <span className="flex items-center justify-between text-sm">
              <span className="font-medium">{NOMBRE_GRUPO[g]}</span>
              <span className="text-xs text-ink-muted">{Math.round((monto / total) * 100)}%</span>
            </span>
            <span className="font-mono text-2xl font-semibold">{pesosCorto(monto)}</span>
            <span className="flex items-center justify-between text-xs text-ink-muted">
              <span>{centros} {centros === 1 ? "centro" : "centros"}</span>
              {cambio != null && (
                <span className={Math.round(cambio) === 0 ? "" : cambio > 0 ? "text-valido" : "text-error"}>{textoVariacion(cambio)}</span>
              )}
            </span>
            <span className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
              <span className="animar-llenar block h-full rounded-full bg-teal" style={{ width: `${Math.max(2, (monto / total) * 100)}%` }} />
            </span>
          </EnlaceVentas>
        );
      })}
    </div>
  );
}

/** Montos por centro (contacto de la guia) de la empresa elegida. */
function Centros({ datos, empresa }: { datos: AgregadoPeriodo; empresa: GrupoEmpresa }) {
  const lista = Object.entries(datos.porCentro[empresa] ?? {}).sort((a, b) => b[1].monto - a[1].monto);
  return (
    <Bloque titulo={`Centros de ${NOMBRE_GRUPO[empresa]}`} comoLeer={`${lista.length} centros con despacho en el período`}>
      {lista.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin despachos en el período.</p>
      ) : (
        // Dos columnas: con 20+ centros una sola lista obliga a bajar mucho. La escala es la misma en ambas.
        <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
          {[lista.slice(0, Math.ceil(lista.length / 2)), lista.slice(Math.ceil(lista.length / 2))].map((mitad, i) => (
            <BarrasReparto
              key={i}
              filas={mitad.map(([centro, v]) => ({
                clave: centro,
                etiqueta: nombreLegible(centro),
                valor: v.monto,
                texto: pesos(v.monto),
                detalle: `${centro}: ${pesos(v.monto)} en ${v.guias} ${v.guias === 1 ? "guía" : "guías"}`,
              }))}
              maximo={lista[0][1].monto}
            />
          ))}
        </div>
      )}
    </Bloque>
  );
}

// ---------------------------------------------------------------------------

const FAMILIA_CORTA: Record<string, string> = { AB: "Abarrotes", CC: "Carnes y cong.", FV: "Frutas y verduras", AS: "Aseo" };

function Cambio({ v }: { v: number | null }) {
  if (v == null) return null;
  return <span className={Math.round(v) === 0 ? "text-ink-muted" : v > 0 ? "text-valido" : "text-error"}>{textoVariacion(v)}</span>;
}

/** Encabezado del mes (todas las empresas): el total en grande, tres datos en linea y la tendencia de 6 meses. */
function Resumen({
  actual,
  comparacion,
  datos,
  datosComparacion,
  familia,
  hrefFamilia,
}: {
  actual: Periodo;
  comparacion: Periodo;
  datos: AgregadoPeriodo;
  datosComparacion: AgregadoPeriodo | null;
  familia: string;
  hrefFamilia: (f: string) => string;
}) {
  const c = datosComparacion;
  const cambio = c ? variacion(datos.monto, c.monto) : null;
  // Lo vendido por familia (todas las empresas); tocar una filtra el resto de la pagina.
  const familias = FAMILIAS.map((f) => {
    const monto = sumarMonto(datos, (p) => p.familia === f) ?? 0;
    const antes = sumarMonto(c, (p) => p.familia === f);
    return { f, monto, v: antes ? variacion(monto, antes) : null };
  });
  return (
    <section className="vidrio animar-subir p-6">
      <div className="flex flex-col justify-between gap-5">
        <div className="text-center" title={`${pesos(datos.monto)} · ${entero(datos.guias)} guías · vs. ${nombrePeriodo(comparacion)}`}>
          <p className="text-sm text-ink-muted">Vendido {cuando(actual)}</p>
          <p className="font-mono text-5xl font-semibold tracking-tight text-teal">{pesosCorto(datos.monto)}</p>
          <p className="mt-1 text-sm">
            <Cambio v={cambio} /> <span className="text-ink-muted">vs. {nombrePeriodo(comparacion)}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 sm:divide-x sm:divide-line">
          {familias.map((x) => (
            <EnlaceVentas
              key={x.f}
              href={hrefFamilia(x.f)}
              activo={familia === x.f}
              title={`${NOMBRE_FAMILIA[x.f]}: ${pesos(x.monto)}`}
              className={`rounded-md px-3 text-center transition-colors hover:text-teal ${familia === x.f ? "text-teal" : ""}`}
            >
              <span className="block truncate text-xs text-ink-muted">{FAMILIA_CORTA[x.f] ?? NOMBRE_FAMILIA[x.f]}</span>
              <span className="block font-mono text-lg font-semibold">{pesosCorto(x.monto)}</span>
              <span className="block text-xs">
                <Cambio v={x.v} />
              </span>
            </EnlaceVentas>
          ))}
        </div>
      </div>
    </section>
  );
}

function sumarMonto(a: AgregadoPeriodo | null, calza: (p: ProductoAgregado) => boolean): number | null {
  if (!a) return null;
  return a.productos.reduce((s, p) => (calza(p) ? s + p.monto : s), 0);
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
