// Busca (solo lectura) los datos de referencia necesarios para el payload de
// creacion de guias: cliente (por RUT), bodegas, ciudades y comunas. No crea
// ni modifica nada en Relbase.
//
// Uso: node scripts/lookup-relbase-reference-data.mjs

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const BASE_URL = "https://api.relbase.cl/api/v1";

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

const CLIENTES_A_BUSCAR = [
  { empresa: "CERQ", rut: "79.784.980-4", nombre: "CERMAQ CHILE S.A." },
  { empresa: "MTX", rut: "79.891.160-0", nombre: "MULTI X S.A" },
  { empresa: "YDR", rut: "96.550.920-8", nombre: "CULTIVOS YADRAN S A" },
];

async function main() {
  loadEnvLocal();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: empresa } = await supabase.from("empresas").select("id").eq("codigo_interno", "CERQ").single();
  const { data: cred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", empresa.id)
    .single();

  const headers = {
    company: decryptToken(cred.token_empresa, process.env.CREDENTIALS_ENCRYPTION_KEY),
    authorization: decryptToken(cred.token_usuario_integrador, process.env.CREDENTIALS_ENCRYPTION_KEY),
  };

  console.log("--- Clientes (busqueda por RUT) ---");
  for (const c of CLIENTES_A_BUSCAR) {
    const res = await fetch(`${BASE_URL}/clientes?query=${encodeURIComponent(c.rut)}`, { headers });
    const json = await res.json();
    console.log(`\n[${c.empresa}] busqueda "${c.rut}" (${c.nombre}):`);
    console.log(JSON.stringify(json, null, 2).slice(0, 1500));
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log("\n--- Bodegas ---");
  const resBodegas = await fetch(`${BASE_URL}/bodegas`, { headers });
  console.log(JSON.stringify(await resBodegas.json(), null, 2));

  console.log("\n--- Ciudades (muestra, buscando Puerto Montt / Quellon) ---");
  const resCiudades = await fetch(`${BASE_URL}/ciudades?query=Puerto Montt`, { headers });
  console.log("Puerto Montt:", JSON.stringify(await resCiudades.json(), null, 2).slice(0, 800));
  await new Promise((r) => setTimeout(r, 150));
  const resCiudades2 = await fetch(`${BASE_URL}/ciudades?query=Quellon`, { headers });
  console.log("Quellon:", JSON.stringify(await resCiudades2.json(), null, 2).slice(0, 800));

  console.log("\n--- Comunas (muestra, buscando Puerto Montt / Chiloe) ---");
  const resComunas = await fetch(`${BASE_URL}/comunas?query=Puerto Montt`, { headers });
  console.log("Puerto Montt:", JSON.stringify(await resComunas.json(), null, 2).slice(0, 800));
  await new Promise((r) => setTimeout(r, 150));
  const resComunas2 = await fetch(`${BASE_URL}/comunas?query=Chiloe`, { headers });
  console.log("Chiloe:", JSON.stringify(await resComunas2.json(), null, 2).slice(0, 800));
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
