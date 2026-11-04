import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import {
  NOMBRE_FAMILIA,
  NOMBRE_GRUPO,
  TAG_VENTAS,
  moverMes,
  nombreMes,
  type AgregadoPeriodo,
  type GrupoEmpresa,
  type Periodo,
  type ProductoAgregado,
} from "@/lib/ventas/indicadores";
import { juntarMismoProducto, unidadDeVenta, type FilaTop, type ParteTop } from "@/lib/ventas/mismo-producto";
import { entero, numero, pesos, textoVariacion, variacion } from "@/lib/util/formato";
import { Bloque } from "@/components/inicio/Bloque";
import { nombreLegible } from "@/components/inicio/Graficos";

/**
 * Detalle de ventas de un mes (mas vendidos, precios, menos vendidos). Vivia
 * en el desplegable «Más detalle» del inicio; desde el 04-11-2026 esta en
 * Reportes (pedido de Hugo).
 */

/** Fuera de rankings, precios y menos vendidos (ver lib/ventas/indicadores.ts). */
const FUERA_DE_RANKINGS = new Set<GrupoEmpresa>(["AMS", "GENERICO"]);

export const catalogoVigente = unstable_cache(
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

export function MasVendidos({ datos, empresa, familia }: { datos: AgregadoPeriodo; empresa: string; familia: string }) {
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
        <div className="grid gap-6 lg:grid-cols-2">
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

export function MenosVendidos({
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

export function Precios({
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
