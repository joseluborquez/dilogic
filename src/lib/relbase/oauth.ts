import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/crypto/tokens";
import type { EstadoConexionRelbase } from "@/lib/supabase/types";

/**
 * OAuth2 de la API v2 de Relbase (authorization_code + PKCE S256, unico flujo
 * que soporta v2: client_credentials emite tokens sin usuario que responden
 * 401 en todo). Un admin autoriza una vez; el refresh_token rota en cada uso.
 */
const OAUTH_URL = "https://api.relbase.cl/oauth";

/**
 * Lo que usa la app: productos y DTEs (leer y emitir guias), clientes y
 * bodegas para el destino, y users:read porque asi lo exige Relbase para
 * /ciudades y /comunas (confirmado contra la spec v2, 24-oct-2026).
 */
export const SCOPES_RELBASE = [
  "products:read",
  "documents:read",
  "documents:write",
  "customers:read",
  "warehouses:read",
  "users:read",
] as const;

/**
 * Cookie temporal con state + code_verifier entre /iniciar y /callback. Con
 * prefijo: en localhost las cookies no se separan por puerto, y el buscador de
 * precios usa "relbase_oauth" para su propia conexion.
 */
export const COOKIE_OAUTH = "dilogic_relbase_oauth";
export const COOKIE_OAUTH_RUTA = "/api/relbase/oauth";
export const COOKIE_OAUTH_DURACION_SEGUNDOS = 600;

interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function obtenerConfigOAuth(): ConfigOAuth {
  const clientId = process.env.RELBASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RELBASE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.RELBASE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Faltan RELBASE_OAUTH_CLIENT_ID, RELBASE_OAUTH_CLIENT_SECRET o RELBASE_OAUTH_REDIRECT_URI."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export interface InicioOAuth {
  url: string;
  state: string;
  verifier: string;
}

export function prepararAutorizacion(): InicioOAuth {
  const { clientId, redirectUri } = obtenerConfigOAuth();
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");

  const url = new URL(`${OAUTH_URL}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES_RELBASE.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), state, verifier };
}

export interface TokensRelbase {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export class RelbaseOAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
    this.name = "RelbaseOAuthError";
  }
}

/** POST /oauth/token. Se reutiliza para la renovacion con refresh_token. */
export async function pedirTokens(
  parametros: Record<string, string>,
  signal?: AbortSignal
): Promise<TokensRelbase> {
  const { clientId, clientSecret } = obtenerConfigOAuth();
  const res = await fetch(`${OAUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parametros }),
    cache: "no-store",
    signal,
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok || !body?.access_token || !body?.refresh_token) {
    throw new RelbaseOAuthError(`Relbase oauth/token respondio ${res.status}`, res.status, body);
  }
  return body as TokensRelbase;
}

export function canjearCodigo(code: string, verifier: string): Promise<TokensRelbase> {
  return pedirTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: obtenerConfigOAuth().redirectUri,
    code_verifier: verifier,
  });
}

/**
 * Guarda (o reemplaza) la conexion. Reconectar deja la fila como nueva:
 * limpia el error y el candado de renovacion.
 */
export async function guardarConexion(tokens: TokensRelbase, usuarioId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const ahora = new Date();
  const { error } = await supabase.from("relbase_conexion").upsert({
    id: true,
    access_token: encryptToken(tokens.access_token),
    refresh_token: encryptToken(tokens.refresh_token),
    access_token_expira_en: new Date(ahora.getTime() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope,
    estado: "conectada",
    ultimo_error: null,
    conectado_por: usuarioId,
    conectado_en: ahora.toISOString(),
    renovado_en: null,
    renovacion_bloqueada_hasta: null,
  });
  if (error) throw new Error(`No se pudo guardar la conexion con Relbase: ${error.message}`);
}

export interface EstadoConexion {
  estado: EstadoConexionRelbase | "sin_conectar";
  conectadoEn: string | null;
  conectadoPor: string | null;
  ultimoError: string | null;
  scopesFaltantes: string[];
}

/** Para mostrar en pantalla. Nunca devuelve tokens. */
export async function obtenerEstadoConexion(): Promise<EstadoConexion> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("relbase_conexion")
    .select("estado, scope, conectado_en, conectado_por, ultimo_error")
    .maybeSingle();

  if (!data) {
    return {
      estado: "sin_conectar",
      conectadoEn: null,
      conectadoPor: null,
      ultimoError: null,
      scopesFaltantes: [],
    };
  }

  let conectadoPor: string | null = null;
  if (data.conectado_por) {
    const { data: perfil } = await supabase
      .from("perfiles")
      .select("nombre, email")
      .eq("id", data.conectado_por)
      .maybeSingle();
    conectadoPor = perfil?.nombre ?? perfil?.email ?? null;
  }

  const concedidos = new Set(data.scope.split(/\s+/));
  return {
    estado: data.estado,
    conectadoEn: data.conectado_en,
    conectadoPor,
    ultimoError: data.ultimo_error,
    scopesFaltantes: SCOPES_RELBASE.filter((s) => !concedidos.has(s)),
  };
}
