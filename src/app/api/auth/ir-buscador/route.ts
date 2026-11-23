import { NextResponse } from "next/server";
import { obtenerUsuario } from "@/lib/auth/sesion";
import { crearPase } from "@/lib/auth/pase";

const URL_BUSCADOR = process.env.NEXT_PUBLIC_URL_BUSCADOR ?? "https://buscador-productos-dilogic.vercel.app";

/** Ir al buscador de productos con un pase (sin volver a escribir la clave). Sin pase posible, igual se va: pedirá ingresar. */
export async function GET() {
  const u = await obtenerUsuario();
  // El enlace es solo para administradores: un operador no recibe pase.
  if (!u || u.estado !== "activo" || u.rol !== "admin" || !process.env.PASE_SECRETO) return NextResponse.redirect(URL_BUSCADOR);
  return NextResponse.redirect(`${URL_BUSCADOR}/api/pase?t=${encodeURIComponent(await crearPase(u.email, "/"))}`);
}
