/**
 * Responde "ok" sin tocar Supabase ni Relbase. La visita cada 5 minutos de
 * .github/workflows/mantener-despierto.yml mantiene encendido el servidor en
 * horario de oficina: arrancar en frio costaba ~4 s en la primera pantalla.
 * Queda fuera del proxy (src/proxy.ts), asi que no crea cliente de Supabase.
 *
 * Vercel agrupa las paginas en funciones segun su maxDuration: esta ruta
 * despierta las de duracion normal; /api/salud/60 y /api/salud/300 las de
 * Guia manual y Traspaso.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "cache-control": "no-store" } });
}
