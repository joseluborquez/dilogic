// Verifica si los codigos "nuevos" (CERQ_AB_xxx, MTX_AB_xxx, YDR_AB_xxx) ya
// existen como `code` en el catalogo real de Relbase, o si Relbase solo
// conoce los codigos viejos (CERQ_146 estilo). Solo lectura.
//
// Uso: node scripts/check-relbase-codes.mjs

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

  const supabase = createClient(url, serviceRoleKey);
  const { data: empresa } = await supabase
    .from("empresas")
    .select("id")
    .eq("codigo_interno", "CERQ")
    .single();
  const { data: cred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", empresa.id)
    .single();

  const headers = {
    company: decryptToken(cred.token_empresa, encryptionKey),
    authorization: decryptToken(cred.token_usuario_integrador, encryptionKey),
    "Content-Type": "application/json",
  };

  let page = 1;
  let lastPage = 1;
  const allCodes = [];
  const companyIds = new Set();
  const businessIds = new Set();

  do {
    const res = await fetch(`${BASE_URL}/productos?page=${page}`, { headers });
    const json = await res.json();
    const products = json.data?.products ?? [];
    lastPage = json.data?.last_page ?? json.meta?.last_page ?? 1;
    for (const p of products) {
      allCodes.push(p.code);
      companyIds.add(p.company_id);
      businessIds.add(p.business_id);
    }
    if (page === 1) {
      console.log("Forma de la respuesta (keys de json.data):", Object.keys(json.data ?? {}));
      console.log("Forma de la respuesta (keys de json):", Object.keys(json));
    }
    page += 1;
    await new Promise((r) => setTimeout(r, 150)); // ~7 req/s
  } while (page <= lastPage && page <= 90); // tope de seguridad

  console.log("\nTotal productos traidos:", allCodes.length, "de", lastPage, "paginas");
  console.log("company_id distintos vistos:", [...companyIds]);
  console.log("business_id distintos vistos:", [...businessIds]);

  const nuevos = allCodes.filter((c) => /^(CERQ|MTX|YDR)_(AB|CC|FV|AS)_\d+$/.test(c ?? ""));
  const viejos = allCodes.filter((c) => /^(CERQ|MTX)_\d+$/.test(c ?? ""));
  console.log("\nCodigos con formato NUEVO (ej. CERQ_AB_001):", nuevos.length);
  console.log("Ejemplos:", nuevos.slice(0, 5));
  console.log("\nCodigos con formato VIEJO (ej. CERQ_146):", viejos.length);
  console.log("Ejemplos:", viejos.slice(0, 5));

  console.log("\nOtros formatos de codigo (muestra):");
  const otros = allCodes.filter((c) => !nuevos.includes(c) && !viejos.includes(c));
  console.log(otros.slice(0, 15));
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
