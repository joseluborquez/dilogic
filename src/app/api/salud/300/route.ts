// Igual que /api/salud, con la duracion de las paginas que despierta
// (ver src/app/api/salud/route.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET() {
  return new Response("ok", { headers: { "cache-control": "no-store" } });
}
