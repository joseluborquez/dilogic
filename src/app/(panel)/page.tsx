import { requerirUsuario } from "@/lib/auth/sesion";
import {
  FAMILIAS,
  NOMBRE_FAMILIA,
  NOMBRE_GRUPO,
  nombreMes,
  nombreMesCorto,
  periodoDeComparacion,
  periodoDelMes,
  ultimosMeses,
  type AgregadoPeriodo,
  type GrupoEmpresa,
  type Periodo,
  type ProductoAgregado,
} from "@/lib/ventas/indicadores";
import { crearPedidorDeVentas } from "@/lib/ventas/con-hoy";
import { pesos, textoVariacion, variacion } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";
import { EnlaceVentas, NavegacionVentas, SelectorMes } from "@/components/inicio/Navegacion";
import { BarrasReparto, nombreLegible } from "@/components/inicio/Graficos";

export const dynamic = "force-dynamic";

const MESES_EN_SELECTOR = 6;
const EMPRESAS_FILTRO: GrupoEmpresa[] = ["CERQ", "MTX", "YDR", "OTROS"];

function primerValor(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

const soloMes = (p: Periodo) => nombreMes(p.mes).split(" ")[0];

/** Para frases: "del 1 al 25 de octubre" / "en septiembre". */
function cuando(p: Periodo): string {
  return p.completo ? `en ${soloMes(p)}` : `del 1 al ${p.dia} de ${soloMes(p)}`;
}

const mayuscula = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const meses = ultimosMeses(MESES_EN_SELECTOR);
  const mes = meses.includes(primerValor(params.mes)) ? primerValor(params.mes) : meses[0];
  const empresa = EMPRESAS_FILTRO.includes(primerValor(params.empresa) as GrupoEmpresa)
    ? (primerValor(params.empresa) as GrupoEmpresa)
    : "";

  const actual = periodoDelMes(mes);
  const comparacion = periodoDeComparacion(actual);

  // La sesion sale junto con la primera consulta: esperarla antes sumaba un viaje.
  const [, pedir] = await Promise.all([requerirUsuario(), crearPedidorDeVentas()]);
  const [empresasCorrida, datos, datosComparacion] = await Promise.all([
    listarEmpresasActivas(),
    pedir(actual),
    pedir(comparacion),
  ]);

  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams();
    const valores = { mes, empresa, ...cambios };
    if (valores.mes && valores.mes !== meses[0]) q.set("mes", valores.mes);
    if (valores.empresa) q.set("empresa", valores.empresa);
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      <NavegacionVentas
        barra={
          <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h1 className="font-display text-3xl font-semibold">Ventas de {nombreMes(mes).split(" ")[0]}</h1>
            <SelectorMes
              meses={[...meses].reverse().map((m) => ({
                valor: m,
                etiqueta: nombreMesCorto(m),
                nombre: mayuscula(nombreMes(m)),
                href: enlace({ mes: m }),
              }))}
              activo={mes}
            />
          </header>
        }
      >
        {!datos ? (
          <div className="vidrio p-6 text-sm text-ink-muted">Todavía no hay ventas cargadas para {nombreMes(mes)}.</div>
        ) : (
          <>
            <Resumen
              actual={actual}
              datos={datos}
              datosComparacion={datosComparacion}
            />

            <Empresas
              datos={datos}
              datosComparacion={datosComparacion}
              activa={empresa}
              href={(g) => enlace({ empresa: g === empresa ? "" : g })}
            />

            {empresa && <Centros datos={datos} empresa={empresa as GrupoEmpresa} />}

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
    <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
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
            className={`vidrio animar-subir elevar retraso-${i + 1} flex flex-col gap-1 p-6 hover:border-teal ${esActiva ? "border-teal ring-1 ring-teal" : ""}`}
          >
            <span className="flex items-center justify-between text-sm">
              <span className="font-medium">{NOMBRE_GRUPO[g]}</span>
              <span className="text-xs text-ink-muted" title="Parte del total del mes">{Math.round((monto / total) * 100)}% del total</span>
            </span>
            <span className="font-display text-2xl font-semibold tabular-nums">{pesos(monto)}</span>
            <span className="flex items-center justify-between text-xs text-ink-muted">
              <span>{centros} {centros === 1 ? "centro" : "centros"}</span>
              {cambio != null && (
                <span className={Math.round(cambio) === 0 ? "" : cambio > 0 ? "text-valido" : "text-error"}>{textoVariacion(cambio)}</span>
              )}
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

/** Encabezado del mes (todas las empresas): el total en grande y lo vendido por familia. */
function Resumen({
  actual,
  datos,
  datosComparacion,
}: {
  actual: Periodo;
  datos: AgregadoPeriodo;
  datosComparacion: AgregadoPeriodo | null;
}) {
  const c = datosComparacion;
  // Lo vendido por familia (todas las empresas). El detalle por familia esta en Reportes.
  const familias = FAMILIAS.map((f) => {
    const monto = sumarMonto(datos, (p) => p.familia === f) ?? 0;
    const antes = sumarMonto(c, (p) => p.familia === f);
    return { f, monto, v: antes ? variacion(monto, antes) : null };
  });
  return (
    <section className="vidrio animar-subir p-6">
      <div className="flex flex-col justify-between gap-5">
        <div className="text-center">
          <p className="text-sm text-ink-muted">Vendido {cuando(actual)}, neto sin IVA</p>
          <p className="mt-1 font-display text-6xl leading-tight font-semibold tracking-tight tabular-nums text-teal">
            {pesos(datos.monto)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-y-3 border-t border-line pt-4 sm:grid-cols-4 sm:divide-x sm:divide-line">
          {familias.map((x) => (
            <div key={x.f} title={`${NOMBRE_FAMILIA[x.f]}: ${pesos(x.monto)}`} className="px-3 text-center">
              <span className="block truncate text-xs text-ink-muted">{FAMILIA_CORTA[x.f] ?? NOMBRE_FAMILIA[x.f]}</span>
              <span className="block font-display text-lg font-semibold tabular-nums">{pesos(x.monto)}</span>
              <span className="block text-xs">
                <Cambio v={x.v} />
              </span>
            </div>
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

