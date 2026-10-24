import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/crypto/tokens";
import { RelbaseOAuthError, pedirTokens, type TokensRelbase } from "./oauth";

/**
 * Entrega un access_token vigente de Relbase v2, renovandolo cuando hace falta.
 *
 * Lo delicado es que el refresh_token ROTA: al usarlo, Relbase entrega uno
 * nuevo y revoca el anterior. Si dos funciones serverless renuevan a la vez,
 * la segunda presenta un token ya revocado y Relbase corta la conexion entera.
 * Por eso solo renueva quien toma el candado de la base
 * (tomar_renovacion_relbase, migracion 0013); el resto espera y relee.
 */

/** Se renueva con este margen para que ningun request salga con un token por vencer. */
const MARGEN_RENOVACION_MS = 2 * 60 * 1000;
/** Duracion del candado: debe cubrir el POST /oauth/token mas el guardado. */
const CANDADO_SEGUNDOS = 30;
const TIMEOUT_OAUTH_MS = 10_000;
const ESPERA_ENTRE_INTENTOS_MS = 500;
/** ~CANDADO_SEGUNDOS: si quien tiene el candado muere, este expira y otro toma el relevo. */
const MAX_INTENTOS = 70;

export class RelbaseSinConexionError extends Error {
  constructor(message = "Relbase no esta conectado. Un administrador debe conectarlo en Empresas.") {
    super(message);
    this.name = "RelbaseSinConexionError";
  }
}

export class RelbaseConexionRevocadaError extends Error {
  constructor(message = "Relbase cerro la conexion. Un administrador debe reconectarla en Empresas.") {
    super(message);
    this.name = "RelbaseConexionRevocadaError";
  }
}

interface FilaConexion {
  access_token: string;
  refresh_token: string;
  access_token_expira_en: string;
  estado: "conectada" | "revocada";
}

// Cache por instancia: evita leer la base en cada llamada a Relbase dentro de
// una misma invocacion (la sincronizacion del catalogo hace ~170 seguidas).
let cache: { token: string; expiraMs: number } | null = null;

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function leerConexion(): Promise<FilaConexion | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("relbase_conexion")
    .select("access_token, refresh_token, access_token_expira_en, estado")
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la conexion con Relbase: ${error.message}`);
  return data;
}

function vigente(fila: FilaConexion): boolean {
  return new Date(fila.access_token_expira_en).getTime() - Date.now() > MARGEN_RENOVACION_MS;
}

async function soltarCandado(cambios: Record<string, unknown> = {}): Promise<void> {
  await getSupabaseServiceClient()
    .from("relbase_conexion")
    .update({ ...cambios, renovacion_bloqueada_hasta: null })
    .eq("id", true);
}

/**
 * Guarda el par nuevo. Si esto falla tras un refresh exitoso, el refresh_token
 * anterior ya esta revocado y el nuevo solo vive en memoria: se reintenta
 * antes de rendirse.
 */
async function guardarTokensRenovados(tokens: TokensRelbase): Promise<void> {
  const ahora = Date.now();
  const cambios = {
    access_token: encryptToken(tokens.access_token),
    refresh_token: encryptToken(tokens.refresh_token),
    access_token_expira_en: new Date(ahora + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope,
    renovado_en: new Date(ahora).toISOString(),
    ultimo_error: null,
    renovacion_bloqueada_hasta: null,
  };
  let ultimoError: unknown;
  for (let intento = 0; intento < 3; intento += 1) {
    const { error } = await getSupabaseServiceClient()
      .from("relbase_conexion")
      .update(cambios)
      .eq("id", true);
    if (!error) return;
    ultimoError = error;
    await esperar(300 * (intento + 1));
  }
  throw new Error(`Relbase renovo el token pero no se pudo guardar: ${String(ultimoError)}`);
}

/** Con el candado tomado. Devuelve el access_token nuevo. */
async function renovar(fila: FilaConexion, rechazado?: string): Promise<string> {
  let tokens: TokensRelbase;
  try {
    tokens = await pedirTokens(
      { grant_type: "refresh_token", refresh_token: decryptToken(fila.refresh_token) },
      AbortSignal.timeout(TIMEOUT_OAUTH_MS)
    );
  } catch (err) {
    // 400/401 = invalid_grant: el refresh_token fue revocado (rotado por
    // otro, revocado a mano o app desactivada). No tiene arreglo sin un admin.
    if (err instanceof RelbaseOAuthError && (err.status === 400 || err.status === 401)) {
      await soltarCandado({
        estado: "revocada",
        ultimo_error: `Relbase rechazo la renovacion (${err.status}). Hay que reconectar.`,
      });
      cache = null;
      throw new RelbaseConexionRevocadaError();
    }
    // Falla transitoria (red, 5xx, timeout): la conexion sigue sana. Si el
    // token actual todavia no vence (solo entro al margen), sirve igual.
    await soltarCandado({ ultimo_error: `No se pudo renovar el token: ${String(err)}` });
    const actual = decryptToken(fila.access_token);
    if (new Date(fila.access_token_expira_en).getTime() > Date.now() && actual !== rechazado) {
      return actual;
    }
    throw err;
  }

  await guardarTokensRenovados(tokens);
  cache = { token: tokens.access_token, expiraMs: Date.now() + tokens.expires_in * 1000 };
  return tokens.access_token;
}

/**
 * @param rechazado access_token que Relbase acaba de responder con 401. Si se
 * pasa, se renueva aunque parezca vigente, salvo que otro ya lo haya cambiado.
 */
export async function obtenerAccessToken(rechazado?: string): Promise<string> {
  if (!rechazado && cache && cache.expiraMs - Date.now() > MARGEN_RENOVACION_MS) {
    return cache.token;
  }
  cache = null;

  for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
    const fila = await leerConexion();
    if (!fila) throw new RelbaseSinConexionError();
    if (fila.estado === "revocada") throw new RelbaseConexionRevocadaError();

    const actual = decryptToken(fila.access_token);
    if (vigente(fila) && actual !== rechazado) {
      cache = { token: actual, expiraMs: new Date(fila.access_token_expira_en).getTime() };
      return actual;
    }

    const { data: tomado, error } = await getSupabaseServiceClient().rpc(
      "tomar_renovacion_relbase",
      { p_segundos: CANDADO_SEGUNDOS }
    );
    if (error) throw new Error(`No se pudo tomar el candado de renovacion: ${error.message}`);

    if (tomado) {
      // Releer con el candado en mano: entre la lectura de arriba y el
      // candado, otro pudo terminar de renovar. Renovar con el refresh_token
      // leido antes seria usar uno ya rotado y Relbase revocaria la conexion.
      const fresca = await leerConexion();
      if (!fresca || fresca.estado === "revocada") {
        await soltarCandado();
        continue;
      }
      const tokenFresco = decryptToken(fresca.access_token);
      if (vigente(fresca) && tokenFresco !== rechazado) {
        await soltarCandado();
        cache = { token: tokenFresco, expiraMs: new Date(fresca.access_token_expira_en).getTime() };
        return tokenFresco;
      }
      return renovar(fresca, rechazado);
    }

    await esperar(ESPERA_ENTRE_INTENTOS_MS);
  }

  throw new Error("Se agoto la espera mientras otro proceso renovaba el token de Relbase.");
}
