// Cifra y guarda las credenciales de Relbase (token_empresa +
// token_usuario_integrador) en credenciales_relbase para las empresas
// indicadas. Un solo par de tokens sirve para las 3 empresas (confirmado con
// el usuario: 09-jul-2026).
//
// El token de usuario integrador sale de USUARIO_INTEGRADOR_TOKEN en
// .env.local; el token de empresa nunca se hardcodea aca, se pasa como
// argumento para que este archivo no contenga secretos.
//
// Uso: node scripts/seed-credenciales-relbase.mjs <token_empresa>

import { readFileSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
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

function encryptToken(plaintext, keyB64) {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY invalida");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString("base64")).join(".");
}

const EMPRESAS_DESTINO = ["CERQ", "MTX", "YDR"];

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const tokenUsuarioIntegrador = process.env.USUARIO_INTEGRADOR_TOKEN;
  const tokenEmpresa = process.argv[2];

  if (!url || !serviceRoleKey || !encryptionKey || !tokenUsuarioIntegrador) {
    throw new Error("Faltan variables de entorno requeridas en .env.local");
  }
  if (!tokenEmpresa) {
    throw new Error("Falta el token_empresa como argumento: node scripts/seed-credenciales-relbase.mjs <token>");
  }

  const supabase = createClient(url, serviceRoleKey);

  const tokenEmpresaCifrado = encryptToken(tokenEmpresa, encryptionKey);
  const tokenUsuarioCifrado = encryptToken(tokenUsuarioIntegrador, encryptionKey);

  for (const codigo of EMPRESAS_DESTINO) {
    const { data: empresa, error: errEmpresa } = await supabase
      .from("empresas")
      .select("id")
      .eq("codigo_interno", codigo)
      .single();

    if (errEmpresa || !empresa) {
      console.error(`Empresa ${codigo} no encontrada, se omite.`);
      continue;
    }

    const { error: errUpsert } = await supabase
      .from("credenciales_relbase")
      .upsert(
        {
          empresa_id: empresa.id,
          token_empresa: tokenEmpresaCifrado,
          token_usuario_integrador: tokenUsuarioCifrado,
          version_api: "v1",
        },
        { onConflict: "empresa_id" }
      );

    if (errUpsert) {
      console.error(`Error guardando credenciales para ${codigo}:`, errUpsert.message);
      continue;
    }

    console.log(`OK: credenciales guardadas (cifradas) para ${codigo}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
