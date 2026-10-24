// Exploracion de la API v2 de Relbase (Paso 1 de la migracion v1 -> v2).
// SOLO LECTURA: todas las llamadas de negocio son GET. No crea ni modifica
// nada en Relbase. Compara la forma de las respuestas v1 vs v2 para los
// endpoints que usa la app.
//
// v2 usa OAuth2 authorization_code + PKCE. Como Relbase solo acepta redirect
// URIs https, la autorizacion vuelve a https://dilogic.vercel.app/...; esa
// ruta aun no existe y responde 401/404, pero el `code` queda en la barra de
// direcciones y se pega aca.
//
// Uso:
//   node scripts/explorar-relbase-v2.mjs autorizar        -> imprime la URL a abrir
//   node scripts/explorar-relbase-v2.mjs canjear "<URL>"  -> canjea el code por tokens
//   node scripts/explorar-relbase-v2.mjs leer             -> GETs v1 y v2 + resumen
//
// Los tokens y respuestas se guardan FUERA del repo, en ../relbase-spec/.

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dirSalida = path.resolve(projectRoot, "..", "relbase-spec");
const archivoPkce = path.join(dirSalida, "pkce-pendiente.json");
const archivoTokens = path.join(dirSalida, "tokens-v2.json");
const dirRespuestas = path.join(dirSalida, "respuestas");

const OAUTH_URL = "https://api.relbase.cl/oauth";
const BASE_V1 = "https://api.relbase.cl/api/v1";
const BASE_V2 = "https://api.relbase.cl/api/v2";
const SCOPES = [
  "products:read",
  "documents:read",
  "documents:write",
  "customers:read",
  "warehouses:read",
  "users:read",
].join(" ");

function loadEnvLocal() {
  const content = readFileSync(path.join(projectRoot, ".env.local"), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function decryptToken(payload, keyB64) {
  const key = Buffer.from(keyB64, "base64");
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function guardarJson(archivo, datos) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  writeFileSync(archivo, JSON.stringify(datos, null, 2));
  chmodSync(archivo, 0o600);
}

const base64url = (buf) => buf.toString("base64url");

// --- OAuth -----------------------------------------------------------------

function autorizar() {
  const verifier = base64url(randomBytes(64)); // 86 caracteres URL-safe
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));
  guardarJson(archivoPkce, { verifier, state, creado: new Date().toISOString() });

  const url = new URL(`${OAUTH_URL}/authorize`);
  url.searchParams.set("client_id", process.env.RELBASE_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.RELBASE_OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  console.log("\n1) Abre esta URL en el navegador e inicia sesion en Relbase:\n");
  console.log(url.toString());
  console.log(
    "\n2) Autoriza la aplicacion. Llegaras a dilogic.vercel.app con un error" +
      " (normal, la ruta aun no existe).\n3) Copia la URL COMPLETA de la barra de" +
      " direcciones y ejecuta:\n\n   node scripts/explorar-relbase-v2.mjs canjear \"<URL>\"\n"
  );
}

async function pedirToken(parametros) {
  const res = await fetch(`${OAUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.RELBASE_OAUTH_CLIENT_ID,
      client_secret: process.env.RELBASE_OAUTH_CLIENT_SECRET,
      ...parametros,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`oauth/token ${res.status}: ${JSON.stringify(body)}`);
  }
  // Se guarda de inmediato: el refresh_token anterior ya quedo revocado.
  const tokens = { ...body, obtenido_en: Math.floor(Date.now() / 1000) };
  guardarJson(archivoTokens, tokens);
  return tokens;
}

async function canjear(urlRetorno) {
  if (!urlRetorno) throw new Error('Falta la URL: canjear "<URL>"');
  if (!existsSync(archivoPkce)) throw new Error("Primero ejecuta: autorizar");
  const { verifier, state } = JSON.parse(readFileSync(archivoPkce, "utf8"));
  const params = new URL(urlRetorno).searchParams;

  if (params.get("error")) {
    throw new Error(`Relbase rechazo la autorizacion: ${params.get("error")} ${params.get("error_description") ?? ""}`);
  }
  if (params.get("state") !== state) {
    throw new Error("El state no coincide: vuelve a ejecutar 'autorizar'.");
  }
  const code = params.get("code");
  if (!code) throw new Error("La URL no trae ?code=");

  const tokens = await pedirToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.RELBASE_OAUTH_REDIRECT_URI,
    code_verifier: verifier,
  });
  writeFileSync(archivoPkce, "{}");
  console.log(`Tokens obtenidos. scope="${tokens.scope}", expira en ${tokens.expires_in}s.`);
  console.log("Siguiente: node scripts/explorar-relbase-v2.mjs leer");
}

async function accessTokenVigente() {
  if (!existsSync(archivoTokens)) throw new Error("No hay tokens: ejecuta autorizar/canjear.");
  let tokens = JSON.parse(readFileSync(archivoTokens, "utf8"));
  const vence = tokens.obtenido_en + (tokens.expires_in ?? 900);
  if (Date.now() / 1000 > vence - 60) {
    console.log("Access token vencido o por vencer: renovando con refresh_token...");
    tokens = await pedirToken({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  }
  return tokens.access_token;
}

// --- Lecturas --------------------------------------------------------------

async function get(base, ruta, headers) {
  const res = await fetch(`${base}${ruta}`, { method: "GET", headers });
  const texto = await res.text();
  let body;
  try {
    body = JSON.parse(texto);
  } catch {
    body = texto.slice(0, 500);
  }
  return {
    status: res.status,
    rateLimit: {
      limit: res.headers.get("x-ratelimit-limit"),
      remaining: res.headers.get("x-ratelimit-remaining"),
    },
    body,
  };
}

/** Describe la forma de una respuesta sin volcarla completa. */
function forma(body) {
  if (!body || typeof body !== "object") return { tipo: typeof body };
  const data = body.data;
  const resumen = { claves: Object.keys(body), meta: body.meta };
  if (Array.isArray(data)) {
    resumen.data = `array(${data.length})`;
    resumen.camposItem = data[0] ? Object.keys(data[0]) : [];
  } else if (data && typeof data === "object") {
    resumen.dataClaves = Object.keys(data);
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) {
        resumen.lista = `data.${k} (${v.length})`;
        resumen.camposItem = v[0] ? Object.keys(v[0]) : [];
        break;
      }
    }
  }
  return resumen;
}

function diferencias(a, b) {
  const sa = new Set(a ?? []);
  const sb = new Set(b ?? []);
  return {
    soloV1: [...sa].filter((x) => !sb.has(x)),
    soloV2: [...sb].filter((x) => !sa.has(x)),
  };
}

async function leer() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Datos reales para consultar: credenciales v1, un SKU sincronizado, la
  // empresa con destino configurado y la ultima guia con id de Relbase.
  const { data: cred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .limit(1)
    .single();
  const clave = process.env.CREDENTIALS_ENCRYPTION_KEY;
  // Si la clave local no es la que cifro credenciales_relbase, se compara
  // solo v2 en vez de abortar.
  let headersV1 = null;
  try {
    headersV1 = {
      company: decryptToken(cred.token_empresa, clave),
      authorization: decryptToken(cred.token_usuario_integrador, clave),
    };
  } catch {
    console.log("AVISO: CREDENTIALS_ENCRYPTION_KEY no descifra credenciales_relbase; se omite v1.\n");
  }

  const { data: producto } = await supabase
    .from("productos_catalogo")
    .select("sku")
    .not("product_id_relbase", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: empresa } = await supabase
    .from("empresas")
    .select("relbase_customer_id, dispatch_city_id")
    .not("relbase_customer_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: guia } = await supabase
    .from("guias_generadas")
    .select("dte_id_relbase")
    .not("dte_id_relbase", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const consultas = [
    ["productos_p1", "/productos?page=1"],
    ["productos_p2", "/productos?page=2"],
    producto && ["productos_query", `/productos?query=${encodeURIComponent(producto.sku)}`],
    ["clientes_query", "/clientes?query=a"],
    empresa && ["cliente_detalle", `/clientes/${empresa.relbase_customer_id}`],
    ["bodegas", "/bodegas"],
    ["ciudades", "/ciudades"],
    ["comunas", `/comunas?city_id=${empresa?.dispatch_city_id ?? 1}`],
    ["tipos_traslado", "/dtes/guias/tipos_traslado"],
    guia && ["dte_detalle", `/dtes/${guia.dte_id_relbase}`],
  ].filter(Boolean);

  const accessToken = await accessTokenVigente();
  const headersV2 = { authorization: `Bearer ${accessToken}` };

  const resumen = {};
  for (const [nombre, ruta] of consultas) {
    const v1 = headersV1 ? await get(BASE_V1, ruta, headersV1) : { status: "omitido", body: null };
    const v2 = await get(BASE_V2, ruta, { ...headersV2, "X-Request-Id": randomUUID() });
    guardarJson(path.join(dirRespuestas, `${nombre}.v1.json`), v1);
    guardarJson(path.join(dirRespuestas, `${nombre}.v2.json`), v2);

    const f1 = forma(v1.body);
    const f2 = forma(v2.body);
    resumen[nombre] = {
      ruta,
      status: { v1: v1.status, v2: v2.status },
      rateLimitV2: v2.rateLimit,
      v1: f1,
      v2: f2,
      camposItem: diferencias(f1.camposItem, f2.camposItem),
    };
    const ok = v2.status === 200 ? "OK " : "ERR";
    console.log(`${ok} ${nombre.padEnd(16)} v1=${v1.status} v2=${v2.status}  ${f2.lista ?? f2.data ?? ""}`);
    if (v2.status !== 200) console.log("    v2 meta:", JSON.stringify(v2.body?.meta ?? v2.body));
    // 300 req/min en v2: con ~20 llamadas no hay riesgo, pero se espacia igual.
    await new Promise((r) => setTimeout(r, 300));
  }

  guardarJson(path.join(dirSalida, "resumen-v1-vs-v2.json"), resumen);
  console.log(`\nResumen: ${path.join(dirSalida, "resumen-v1-vs-v2.json")}`);
  console.log(`Respuestas completas: ${dirRespuestas}/`);
}

async function main() {
  loadEnvLocal();
  const [comando, arg] = process.argv.slice(2);
  if (comando === "autorizar") return autorizar();
  if (comando === "canjear") return canjear(arg);
  if (comando === "leer") return leer();
  console.log("Uso: autorizar | canjear \"<URL>\" | leer");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
