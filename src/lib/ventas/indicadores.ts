import "server-only";

import { unstable_cache } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traerTodasLasFilas } from "@/lib/supabase/paginar";
import { dividirEnLotes } from "@/lib/util/lotes";
import { unificarCentros } from "./centros";

/**
 * Indicadores de ventas para la pagina de inicio, calculados desde
 * ventas_guias / ventas_lineas. Reglas de Hugo (25-oct-2026):
 * - Las anuladas nunca cuentan (solo se informa cuantas se descontaron).
 * - Las guias de transporte de bins son informacion de salida, no venta: no
 *   cuentan, tampoco las de Multiexport con precio (traspaso de costo del
 *   transportista al mandante).
 * - AMS es una empresa antigua: queda fuera de rankings, precios y menos
 *   vendidos.
 * - TTF es un cliente ocasional: cuenta como venta, pero sus precios no entran
 *   en la comparacion de precios.
 * - El PRODUCTO GENERICO (traspaso de costos) se informa aparte.
 */

/** Etiqueta de cache: la sincronizacion de ventas la invalida al terminar. */
export const TAG_VENTAS = "ventas";

export type GrupoEmpresa = "CERQ" | "MTX" | "YDR" | "OTROS" | "AMS" | "GENERICO";

export const NOMBRE_GRUPO: Record<GrupoEmpresa, string> = {
  CERQ: "Cermaq",
  MTX: "Multiexport",
  YDR: "Yadran",
  OTROS: "Otros",
  AMS: "AMS (antigua)",
  GENERICO: "Producto genérico",
};

export const FAMILIAS = ["AB", "CC", "FV", "AS"] as const;
export const NOMBRE_FAMILIA: Record<string, string> = {
  AB: "Abarrotes",
  CC: "Carnes y congelados",
  FV: "Frutas y verduras",
  AS: "Aseo",
};

export interface ProductoAgregado {
  codigo: string;
  nombre: string;
  grupo: GrupoEmpresa;
  familia: string | null;
  cantidad: number;
  monto: number;
  /** En cuantas guias aparece. */
  guias: number;
  /** Ultimo precio unitario neto cobrado en el periodo (null: solo a $1, o cliente sin comparacion). */
  ultimoPrecio: number | null;
}

export interface AgregadoPeriodo {
  desde: string;
  hasta: string;
  guias: number;
  anuladas: number;
  binsExcluidas: number;
  cantidad: number;
  monto: number;
  productos: ProductoAgregado[];
  /**
   * Guias validas por empresa y familia ("CERQ|AB", "OTROS|"): una guia con
   * productos de varias familias aparece en cada una. Sirve para contar las
   * guias de un filtro sin contar dos veces la misma.
   */
  guiasPorSegmento: Record<string, number[]>;
  /**
   * Monto y guias por empresa CLIENTE de la guia (customer de Relbase: la guia de
   * un centro de Yadran es de Yadran aunque lleve un codigo de Cermaq) y centro.
   */
  porCentro: Record<string, Record<string, { monto: number; guias: number }>>;
  /** Totales por empresa cliente (suma de sus centros). */
  porCliente: Record<string, { monto: number; guias: number }>;
}

const segmento = (grupo: string, familia: string | null) => `${grupo}|${familia ?? ""}`;

/**
 * Monto y guias del periodo para un filtro de empresa y familia ("" = todas).
 * Sin filtro son los totales del periodo, incluidos AMS y el generico.
 */
export function totalesFiltrados(datos: AgregadoPeriodo, empresa: string, familia: string): { monto: number; guias: number } {
  if (!empresa && !familia) return { monto: datos.monto, guias: datos.guias };
  const calza = (grupo: string, fam: string | null) => (!empresa || grupo === empresa) && (!familia || fam === familia);
  const monto = datos.productos.filter((p) => calza(p.grupo, p.familia)).reduce((s, p) => s + p.monto, 0);
  const guias = new Set<number>();
  for (const [k, ids] of Object.entries(datos.guiasPorSegmento)) {
    const [grupo, fam] = k.split("|");
    if (calza(grupo, fam || null)) for (const id of ids) guias.add(id);
  }
  return { monto, guias: guias.size };
}

const esBins = (contacto: string | null) => /\bBINS\b/i.test(contacto ?? "");
const esCodigoBins = (codigo: string | null) => /^O-TB-/i.test(codigo ?? "");
const esAms = (codigo: string | null) => /^(ANU-)?AMS[_-]/i.test(codigo ?? "");
/** Clientes cuyos precios no se comparan. */
const sinComparacionDePrecio = (codigo: string | null) => /^TTF[_-]/i.test(codigo ?? "");

function grupoDe(empresa: string, codigo: string | null): GrupoEmpresa {
  if (empresa === "GENERICO") return "GENERICO";
  if (esAms(codigo)) return "AMS";
  if (empresa === "CERQ" || empresa === "MTX" || empresa === "YDR") return empresa;
  return "OTROS";
}

/** grupo|centro -> totales, con los nombres del mismo centro juntados por empresa (lib/ventas/centros). */
function juntarCentros(centros: Map<string, { monto: number; dtes: Set<number> }>): AgregadoPeriodo["porCentro"] {
  const porGrupo = new Map<string, { nombre: string; monto: number; dtes: Set<number> }[]>();
  for (const [k, v] of centros) {
    const grupo = k.slice(0, k.indexOf("|"));
    porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), { nombre: k.slice(k.indexOf("|") + 1), ...v }]);
  }
  const salida: AgregadoPeriodo["porCentro"] = {};
  for (const [grupo, lista] of porGrupo) {
    const nombreDe = unificarCentros(lista.map((c) => ({ nombre: c.nombre, guias: c.dtes.size })));
    const juntos = new Map<string, { monto: number; dtes: Set<number> }>();
    for (const c of lista) {
      const n = nombreDe.get(c.nombre) ?? c.nombre;
      const j = juntos.get(n) ?? juntos.set(n, { monto: 0, dtes: new Set() }).get(n)!;
      j.monto += c.monto;
      for (const d of c.dtes) j.dtes.add(d);
    }
    salida[grupo] = Object.fromEntries([...juntos].map(([n, v]) => [n, { monto: v.monto, guias: v.dtes.size }]));
  }
  return salida;
}

/** Sin cache: para scripts y pruebas fuera de Next. */
export async function calcularAgregado(desde: string, hasta: string): Promise<AgregadoPeriodo> {
  const supabase = getSupabaseServiceClient();
  const guias = await traerTodasLasFilas((d, h) =>
    supabase
      .from("ventas_guias")
      .select("dte_id, fecha, anulada, contacto, customer_id")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("dte_id")
      .range(d, h)
  );

  const anuladas = guias.filter((g) => g.anulada).length;
  const candidatas = guias.filter((g) => !g.anulada);
  const fechaPorGuia = new Map(candidatas.map((g) => [g.dte_id, g.fecha]));
  const { data: empresas } = await supabase.from("empresas").select("codigo_interno, relbase_customer_id");
  const empresaDeCliente = new Map((empresas ?? []).filter((e) => e.relbase_customer_id).map((e) => [Number(e.relbase_customer_id), e.codigo_interno]));
  const clientePorGuia = new Map(candidatas.map((g) => [g.dte_id, empresaDeCliente.get(Number(g.customer_id)) ?? "OTROS"]));
  const centroPorGuia = new Map(candidatas.map((g) => [g.dte_id, (g.contacto ?? "").trim().toUpperCase() || "SIN CENTRO"]));
  const binsPorContacto = new Set(candidatas.filter((g) => esBins(g.contacto)).map((g) => g.dte_id));

  const lotes = await Promise.all(
    dividirEnLotes(
      candidatas.map((g) => g.dte_id),
      150
    ).map((ids) =>
      traerTodasLasFilas((d, h) =>
        supabase
          .from("ventas_lineas")
          .select("dte_id, linea, codigo, nombre, empresa, familia, cantidad, precio, monto_neto")
          .in("dte_id", ids)
          .order("dte_id")
          .order("linea")
          .range(d, h)
      )
    )
  );
  const lineas = lotes.flat();

  const bins = new Set(binsPorContacto);
  for (const l of lineas) if (esCodigoBins(l.codigo)) bins.add(l.dte_id);

  const porCodigo = new Map<
    string,
    ProductoAgregado & { dtes: Set<number>; fechaPrecio: string }
  >();
  let cantidad = 0;
  let monto = 0;
  const segmentos = new Map<string, Set<number>>();
  const centros = new Map<string, { monto: number; dtes: Set<number> }>();
  for (const l of lineas) {
    if (bins.has(l.dte_id)) continue;
    const codigo = l.codigo ?? "(sin código)";
    const fecha = fechaPorGuia.get(l.dte_id) ?? "";
    // A pesos enteros: Relbase guarda algunos netos con decimales (6129,252)
    // y sin redondear aparecian "cambios de precio" que no existen.
    const precio = Math.round(Number(l.precio));
    let p = porCodigo.get(codigo);
    if (!p) {
      p = {
        codigo,
        nombre: l.nombre ?? codigo,
        grupo: grupoDe(l.empresa, l.codigo),
        familia: l.familia,
        cantidad: 0,
        monto: 0,
        guias: 0,
        ultimoPrecio: null,
        dtes: new Set(),
        fechaPrecio: "",
      };
      porCodigo.set(codigo, p);
    }
    p.cantidad += Number(l.cantidad);
    p.monto += Number(l.monto_neto);
    p.dtes.add(l.dte_id);
    const seg = segmento(p.grupo, p.familia);
    (segmentos.get(seg) ?? segmentos.set(seg, new Set()).get(seg)!).add(l.dte_id);
    const kc = `${clientePorGuia.get(l.dte_id) ?? "OTROS"}|${centroPorGuia.get(l.dte_id) ?? "SIN CENTRO"}`;
    const c = centros.get(kc) ?? centros.set(kc, { monto: 0, dtes: new Set() }).get(kc)!;
    c.monto += Number(l.monto_neto);
    c.dtes.add(l.dte_id);
    // Precio a $1 = guia "sin valor": no es un precio de venta.
    if (precio > 1 && !sinComparacionDePrecio(l.codigo) && fecha >= p.fechaPrecio) {
      p.ultimoPrecio = precio;
      p.fechaPrecio = fecha;
    }
    cantidad += Number(l.cantidad);
    monto += Number(l.monto_neto);
  }

  return {
    desde,
    hasta,
    guias: candidatas.length - bins.size,
    anuladas,
    binsExcluidas: bins.size,
    cantidad,
    monto,
    productos: [...porCodigo.values()].map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      grupo: p.grupo,
      familia: p.familia,
      cantidad: p.cantidad,
      monto: p.monto,
      guias: p.dtes.size,
      ultimoPrecio: p.ultimoPrecio,
    })),
    guiasPorSegmento: Object.fromEntries([...segmentos].map(([k, ids]) => [k, [...ids]])),
    porCentro: juntarCentros(centros),
    porCliente: [...centros].reduce<AgregadoPeriodo["porCliente"]>((acc, [k, v]) => {
      const grupo = k.slice(0, k.indexOf("|"));
      const t = (acc[grupo] ??= { monto: 0, guias: 0 });
      t.monto += v.monto;
      t.guias += v.dtes.size;
      return acc;
    }, {}),
  };
}

/**
 * Cacheado: los datos cambian una vez al dia (sincronizacion de ventas, que
 * invalida TAG_VENTAS). Recalcular en cada visita significaba traer ~10 mil
 * lineas por mes desde Supabase.
 */
export const agregadoPeriodo = unstable_cache(calcularAgregado, ["ventas-agregado-v5"], {
  tags: [TAG_VENTAS],
  revalidate: 3600,
});

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function hoyChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

/** "2026-10" desplazado `n` meses. */
export function moverMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function diasDelMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

export function nombreMesCorto(mes: string): string {
  return MESES_CORTOS[Number(mes.split("-")[1]) - 1];
}

export interface Periodo {
  mes: string;
  desde: string;
  hasta: string;
  /** Ultimo dia incluido (para un mes en curso, hoy). */
  dia: number;
  enCurso: boolean;
  /** Mes entero (no en curso ni recortado a los dias de otro). */
  completo: boolean;
}

/** El mes elegido; si es el mes en curso, del 1 a hoy. */
export function periodoDelMes(mes: string, hoy = hoyChile()): Periodo {
  const enCurso = hoy.startsWith(mes);
  const dia = enCurso ? Number(hoy.slice(8, 10)) : diasDelMes(mes);
  return { mes, desde: `${mes}-01`, hasta: `${mes}-${String(dia).padStart(2, "0")}`, dia, enCurso, completo: !enCurso };
}

/**
 * Contra que se compara: el mes anterior, pero los MISMOS dias si el mes
 * elegido esta en curso (1 al 25 contra 1 al 25), nunca el mes completo.
 */
export function periodoDeComparacion(p: Periodo): Periodo {
  const mes = moverMes(p.mes, -1);
  const ultimo = p.enCurso ? Math.min(p.dia, diasDelMes(mes)) : diasDelMes(mes);
  return {
    mes,
    desde: `${mes}-01`,
    hasta: `${mes}-${String(ultimo).padStart(2, "0")}`,
    dia: ultimo,
    enCurso: false,
    completo: !p.enCurso,
  };
}

/** Los ultimos `n` meses, el actual primero. */
export function ultimosMeses(n: number, hoy = hoyChile()): string[] {
  const actual = hoy.slice(0, 7);
  return Array.from({ length: n }, (_, i) => moverMes(actual, -i));
}

/** Primer dia con ventas cargadas: los meses anteriores salen como "sin datos". */
export const primeraFechaConVentas = unstable_cache(
  async (): Promise<string | null> => {
    const { data } = await getSupabaseServiceClient()
      .from("ventas_guias")
      .select("fecha")
      .order("fecha", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.fecha ?? null;
  },
  ["ventas-primera-fecha-v1"],
  { tags: [TAG_VENTAS], revalidate: 3600 }
);
