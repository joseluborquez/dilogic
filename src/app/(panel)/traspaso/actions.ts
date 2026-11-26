"use server";

import { requerirUsuario } from "@/lib/auth/sesion";
import {
  emitirTraspaso,
  revisarFacturas,
  type FacturaRevisada,
  type ResultadoEmision,
} from "@/lib/traspaso/procesar";
import type { ResultadoTraspaso } from "@/lib/traspaso/armar";

/** Lo que se muestra de cada factura: sin sus lineas leidas. */
export type FacturaEnPantalla = Omit<FacturaRevisada, "leida">;

export type EstadoRevision =
  | { status: "inicial" }
  | { status: "error"; mensaje: string }
  | { status: "ok"; facturas: FacturaEnPantalla[]; calculo: ResultadoTraspaso | null };

export type EstadoEmision = { status: "inicial" } | ({ status: "listo" } & ResultadoEmision);

function archivosDe(formData: FormData): File[] {
  return formData.getAll("facturas").filter((f): f is File => f instanceof File && f.size > 0);
}

/** Ids de compras recibidas en Relbase elegidas en pantalla (sus productos se piden de nuevo a Relbase). */
function comprasDe(formData: FormData): number[] {
  return [...new Set(formData.getAll("compras").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Lee y valida las facturas; no emite nada. */
export async function revisarTraspasoAction(
  _prev: EstadoRevision,
  formData: FormData
): Promise<EstadoRevision> {
  await requerirUsuario();
  const archivos = archivosDe(formData);
  const compras = comprasDe(formData);
  if (archivos.length === 0 && compras.length === 0) {
    return { status: "error", mensaje: "Elige al menos una factura (de Relbase o en PDF)." };
  }
  const revision = await revisarFacturas(archivos, compras);
  // Las lineas leidas no viajan al navegador: al emitir se vuelven a leer.
  const facturas: FacturaEnPantalla[] = revision.facturas.map((f) => ({
    archivo: f.archivo,
    folio: f.folio,
    proveedorRut: f.proveedorRut,
    fecha: f.fecha,
    lineas: f.lineas,
    neto: f.neto,
    total: f.total,
    estado: f.estado,
    mensajes: f.mensajes,
  }));
  return { status: "ok", facturas, calculo: revision.calculo };
}

/** Emite las guias. Vuelve a leer y validar todo en el servidor. */
export async function emitirTraspasoAction(
  _prev: EstadoEmision,
  formData: FormData
): Promise<EstadoEmision> {
  const usuario = await requerirUsuario();
  const resultado = await emitirTraspaso({
    archivos: archivosDe(formData),
    compraIds: comprasDe(formData),
    empresaCodigo: String(formData.get("empresa") ?? ""),
    centro: String(formData.get("centro") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    usuario,
  });
  // Aqui NO se llama a revalidatePath (de ninguna ruta): en Next 16 cualquier
  // revalidatePath dentro de una accion rehace la pantalla ACTUAL (/traspaso,
  // que consulta las compras en Relbase) dentro de esta misma respuesta, y si
  // Relbase se pone lento el resultado no llega y el boton queda en
  // "Emitiendo…" aunque las guias ya salieron (41262 el 23-nov; 41269 y 41270
  // el 26-nov, con revalidatePath("/historial")). /historial es force-dynamic
  // y no lo necesita. La pantalla se refresca aparte desde el navegador,
  // despues de mostrar el resultado.
  // La revision completa (con lineas) no hace falta en pantalla.
  if (!resultado.ok && resultado.revision) {
    return { status: "listo", ok: false, mensaje: resultado.mensaje };
  }
  return { status: "listo", ...resultado };
}
