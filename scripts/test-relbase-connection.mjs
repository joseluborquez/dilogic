// Prueba de conectividad de solo lectura contra la API de Relbase v1.
// No crea ni modifica nada: solo GET /api/v1/productos (pagina 1) y
// GET /api/v1/dtes/guias/tipos_traslado, para confirmar que el token
// funciona y ver la forma real de la respuesta antes de construir el
// mapeo SKU -> product_id.
//
// Uso: node scripts/test-relbase-connection.mjs

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(projectRoot, ".env.local");
  const content = readFileSync(envPath, "utf8");
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
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const BASE_URL = "https://api.relbase.cl/api/v1";

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const empresaCodigo = process.argv[2] || "CERQ";

  const supabase = createClient(url, serviceRoleKey);

  const { data: empresa, error: errEmpresa } = await supabase
    .from("empresas")
    .select("id, nombre")
    .eq("codigo_interno", empresaCodigo)
    .single();
  if (errEmpresa || !empresa) throw new Error(`Empresa ${empresaCodigo} no encontrada`);

  const { data: cred, error: errCred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", empresa.id)
    .single();
  if (errCred || !cred) throw new Error(`Sin credenciales para ${empresaCodigo}`);

  const tokenEmpresa = decryptToken(cred.token_empresa, encryptionKey);
  const tokenUsuario = decryptToken(cred.token_usuario_integrador, encryptionKey);

  const headers = {
    company: tokenEmpresa,
    authorization: tokenUsuario,
    "Content-Type": "application/json",
  };

  console.log(`--- GET /productos (pagina 1) para ${empresa.nombre} ---`);
  const resProductos = await fetch(`${BASE_URL}/productos`, { headers });
  console.log("status:", resProductos.status);
  const bodyProductos = await resProductos.text();
  console.log("body (primeros 2000 caracteres):");
  console.log(bodyProductos.slice(0, 2000));

  console.log(`\n--- GET /dtes/guias/tipos_traslado ---`);
  const resTraslado = await fetch(`${BASE_URL}/dtes/guias/tipos_traslado`, { headers });
  console.log("status:", resTraslado.status);
  const bodyTraslado = await resTraslado.text();
  console.log("body:");
  console.log(bodyTraslado);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
