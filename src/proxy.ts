import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * En Next 16 el antiguo `middleware.ts` se llama `proxy.ts` (misma
 * funcionalidad, ver node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *
 * Aca solo se hace la comprobacion optimista que recomienda la documentacion:
 * si no hay sesion, al login. La autorizacion de verdad (estado activo, rol)
 * vive en cada pagina y server action via lib/auth/sesion.ts, porque el proxy
 * no debe consultar la base en cada request.
 *
 * Tambien refresca el token: sin esto la sesion expira aunque el usuario este
 * trabajando.
 */
const PUBLICAS = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  const respuesta = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return respuesta;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (nuevas) => {
        for (const { name, value, options } of nuevas) {
          respuesta.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (!user && !esPublica) {
    const destino = new URL("/login", request.url);
    // Para volver a donde iba despues de entrar.
    if (ruta !== "/") destino.searchParams.set("volver", ruta + request.nextUrl.search);
    return NextResponse.redirect(destino);
  }

  if (user && ruta === "/login") {
    return NextResponse.redirect(new URL("/nueva-corrida", request.url));
  }

  return respuesta;
}

export const config = {
  // Se excluyen estaticos e imagenes: no necesitan sesion y encarecerian cada
  // request con una llamada a Supabase.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
