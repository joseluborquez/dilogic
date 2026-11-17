/**
 * Pase entre la app de guías y el buscador de productos (unificación, paso 3b: 17-11-2026): al saltar de una app a
 * la otra, la de origen firma «quién es y a dónde va» con PASE_SECRETO (la misma clave en las dos apps) y la otra lo
 * acepta sin pedir la clave. Vale 60 segundos. La cuenta se reconoce por el correo y debe existir activa en las dos;
 * si no, se va al ingreso normal. Mismo archivo en las dos apps (lib/pase.ts en el buscador).
 */
const VIGENCIA_MS = 60_000;

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

async function firmar(texto: string) {
  const secreto = process.env.PASE_SECRETO;
  if (!secreto) throw new Error("Falta PASE_SECRETO");
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(texto)));
}

function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** Solo rutas internas ("/utilidad"), nunca otro sitio ("//sitio", "https://…"). */
export const destinoSeguro = (d: string | null | undefined) => (d && d.startsWith("/") && !d.startsWith("//") ? d : "/");

export async function crearPase(correo: string, destino = "/") {
  const datos = b64(new TextEncoder().encode(JSON.stringify({ c: correo.trim().toLowerCase(), v: Date.now() + VIGENCIA_MS, d: destinoSeguro(destino) })));
  return `${datos}.${await firmar(datos)}`;
}

/** El correo y el destino del pase, o null si la firma no calza o ya venció. */
export async function leerPase(pase: string | null): Promise<{ correo: string; destino: string } | null> {
  if (!pase || !process.env.PASE_SECRETO) return null;
  const [datos, firma] = pase.split(".");
  if (!datos || !firma || !igual(firma, await firmar(datos))) return null;
  try {
    const { c, v, d } = JSON.parse(Buffer.from(datos, "base64url").toString("utf8"));
    if (typeof c !== "string" || typeof v !== "number" || v < Date.now()) return null;
    return { correo: c, destino: destinoSeguro(d) };
  } catch {
    return null;
  }
}
