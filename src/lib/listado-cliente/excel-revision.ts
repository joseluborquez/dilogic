/**
 * El Excel para revisar el cruce antes de crear la guia: una fila por linea
 * del cliente con lo propuesto, el precio y las dudas, coloreada por estado.
 */
import { crearXlsx, ESTILO, type CeldaXlsx } from "@/lib/excel/escribir";
import { NOMBRE_EMPRESA, OPCIONES_PRECIO, type OpcionPrecio } from "@/lib/guia-manual/resolver";
import type { Cruce } from "./cruce";

const ETIQUETA_ESTADO = { ok: "OK", revisar: "Revisar", "sin-calce": "Sin calce" } as const;
const ESTILO_ESTADO = { ok: ESTILO.ok, revisar: ESTILO.revisar, "sin-calce": ESTILO.sinCalce } as const;

export function excelRevision(cruces: Cruce[], opcion: OpcionPrecio, archivo: string): Uint8Array {
  const etiquetaOpcion = OPCIONES_PRECIO.find((o) => o.valor === opcion)?.etiqueta ?? opcion;
  const fecha = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date());
  const t = (v: string | number | null, s?: number): CeldaXlsx => ({ v, s });

  const encabezados = [
    "Fila cliente",
    "Lo que pidió el cliente",
    "Cantidad",
    "Unidad cliente",
    "Estado",
    "Dudas",
    "Código propuesto",
    "Producto propuesto",
    "Empresa",
    "Precio unitario",
    "Total",
    "Precio desde",
    "Parecido",
    "Otras opciones",
  ];

  const filas: CeldaXlsx[][] = [
    [t("Revisión de listado del cliente", ESTILO.titulo)],
    [t(`Archivo: ${archivo} · Opción de precio: ${etiquetaOpcion} · ${fecha}`)],
    [],
    encabezados.map((h) => t(h, ESTILO.encabezado)),
  ];

  let neto = 0;
  for (const c of cruces) {
    const r = c.resuelta;
    const precio = r?.precio ?? null;
    const total = precio != null && c.fila.cantidad != null ? Math.round(precio * c.fila.cantidad) : null;
    if (total != null) neto += total;
    const empresa = r && !r.esGenerico ? (NOMBRE_EMPRESA[r.codigo.split("_")[0]] ?? "") : "";
    const desde = !r || precio == null ? "" : r.esGenerico ? "precio del producto elegido" : c.elegido?.origenPrecio === "ventas" ? "último cobrado" : "catálogo";
    filas.push([
      t(c.fila.fila),
      t(c.fila.texto, ESTILO.ajustado),
      t(c.fila.cantidad ?? (c.fila.cantidadOriginal || null)),
      t(c.fila.unidad),
      t(ETIQUETA_ESTADO[c.estado], ESTILO_ESTADO[c.estado]),
      t(c.dudas.join(" "), ESTILO.ajustado),
      t(r?.codigo ?? "O-PG-166053 (genérico)"),
      t(r ? (r.esGenerico ? `GENÉRICO: ${r.descripcion ?? ""}` : r.nombre) : `GENÉRICO: ${c.fila.texto}`, ESTILO.ajustado),
      t(empresa),
      t(precio, ESTILO.pesos),
      t(total, ESTILO.pesos),
      t(desde),
      t(c.candidatos[0] && c.elegido ? `${Math.round(c.candidatos[0].parecido * 100)}%` : ""),
      t(
        c.candidatos
          .filter((x) => x.producto.codigo !== c.elegido?.codigo)
          .slice(0, 3)
          .map((x) => `${x.producto.codigo} ${x.producto.nombre}`)
          .join(" · "),
        ESTILO.ajustado
      ),
    ]);
  }

  const ultima = filas.length;
  filas.push([], [t(""), t("Total neto (líneas con precio)", ESTILO.encabezado), t(""), t(""), t(""), t(""), t(""), t(""), t(""), t(""), t(neto, ESTILO.pesosNegrita)]);
  const cuenta = (e: Cruce["estado"]) => cruces.filter((c) => c.estado === e).length;
  filas.push([t(""), t(`${cruces.length} líneas: ${cuenta("ok")} OK, ${cuenta("revisar")} por revisar, ${cuenta("sin-calce")} sin calce (irán como genérico).`)]);

  return crearXlsx({
    nombre: "Revisión",
    anchos: [8, 38, 10, 12, 11, 48, 16, 40, 12, 14, 14, 18, 10, 60],
    filas,
    filasFijas: 4,
    filtro: `A4:N${ultima}`,
  });
}
