import "server-only";

import { timingSafeEqual } from "node:crypto";

/** Vercel manda "Authorization: Bearer <CRON_SECRET>" en cada invocacion de un cron. */
export function cronAutorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  const recibido = request.headers.get("authorization") ?? "";
  if (!secreto) return false;
  const esperado = Buffer.from(`Bearer ${secreto}`);
  const dado = Buffer.from(recibido);
  return esperado.length === dado.length && timingSafeEqual(esperado, dado);
}
