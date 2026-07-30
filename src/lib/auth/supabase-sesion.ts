import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Cliente ligado a las cookies del request: es el que sabe quien inicio sesion.
 * Usa la clave anonima (no la de servicio) porque solo maneja la sesion; todo
 * lo que toca datos sigue pasando por getSupabaseServiceClient.
 */
export async function getSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en las variables de entorno."
    );
  }

  const almacen = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (nuevas) => {
        try {
          for (const { name, value, options } of nuevas) {
            almacen.set(name, value, options);
          }
        } catch {
          // Los Server Components no pueden escribir cookies. Renovar la sesion
          // es tarea del proxy y de las server actions, que si pueden: aca se
          // ignora sin romper el render.
        }
      },
    },
  });
}
