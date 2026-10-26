"use server";

import { revalidatePath } from "next/cache";
import { requerirAdmin } from "@/lib/auth/sesion";
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

/** Lee y valida las facturas; no emite nada. */
export async function revisarTraspasoAction(
  _prev: EstadoRevision,
  formData: FormData
): Promise<EstadoRevision> {
  await requerirAdmin();
  const archivos = archivosDe(formData);
  if (archivos.length === 0) return { status: "error", mensaje: "Elige al menos una factura en PDF." };
  const revision = await revisarFacturas(archivos);
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
  const usuario = await requerirAdmin();
  const resultado = await emitirTraspaso({
    archivos: archivosDe(formData),
    empresaCodigo: String(formData.get("empresa") ?? ""),
    centro: String(formData.get("centro") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    usuario,
  });
  revalidatePath("/historial");
  // La revision completa (con lineas) no hace falta en pantalla.
  if (!resultado.ok && resultado.revision) {
    return { status: "listo", ok: false, mensaje: resultado.mensaje };
  }
  return { status: "listo", ...resultado };
}
