// Sincroniza productos_catalogo.product_id_relbase contra el catalogo real
// de Relbase. Solo lectura hacia Relbase (GET /api/v1/productos); escribe
// unicamente en nuestra propia base de datos (productos_catalogo).
//
// Uso: node scripts/sync-catalogo-relbase.mjs

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const BASE_URL = "https://api.relbase.cl/api/v1";
const MAX_REQ_PER_SECOND = 7;

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

async function main() {
  loadEnvLocal();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

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
    company: decryptToken(cred.token_empresa, process.env.CREDENTIALS_ENCRYPTION_KEY),
    authorization: decryptToken(cred.token_usuario_integrador, process.env.CREDENTIALS_ENCRYPTION_KEY),
  };

  console.log("Descargando catalogo completo de Relbase (solo lectura)...");
  const productosRelbase = new Map(); // code -> {id, name}
  let page = 1;
  let totalPages = 1;
  const codigosDuplicadosEnRelbase = new Map(); // code -> [ids]

  do {
    const res = await fetch(`${BASE_URL}/productos?page=${page}`, { headers });
    if (!res.ok) throw new Error(`Relbase respondio ${res.status} en pagina ${page}`);
    const json = await res.json();
    totalPages = json.meta.total_pages;
    for (const p of json.data.products) {
      if (!p.code) continue;
      if (productosRelbase.has(p.code)) {
        const arr = codigosDuplicadosEnRelbase.get(p.code) ?? [productosRelbase.get(p.code).id];
        arr.push(p.id);
        codigosDuplicadosEnRelbase.set(p.code, arr);
      }
      productosRelbase.set(p.code, { id: p.id, name: p.name });
    }
    if (page % 20 === 0 || page === totalPages) {
      console.log(`  pagina ${page}/${totalPages}...`);
    }
    page += 1;
    await new Promise((r) => setTimeout(r, 1000 / MAX_REQ_PER_SECOND));
  } while (page <= totalPages);

  console.log(`Total productos en Relbase: ${productosRelbase.size} codigos unicos de ${totalPages * 12} aprox.`);
  if (codigosDuplicadosEnRelbase.size > 0) {
    console.log(`ADVERTENCIA: ${codigosDuplicadosEnRelbase.size} codigos duplicados en Relbase (mismo code, distinto id):`);
    for (const [code, ids] of [...codigosDuplicadosEnRelbase.entries()].slice(0, 10)) {
      console.log(`  ${code}: ids ${ids.join(", ")}`);
    }
  }

  // Traer nuestro catalogo completo
  const { data: nuestroCatalogo, error } = await supabase
    .from("productos_catalogo")
    .select("id, sku, empresa_id, empresas(codigo_interno)");
  if (error) throw error;

  let matched = 0;
  let unmatched = 0;
  const unmatchedPorEmpresa = {};
  const updates = [];

  for (const row of nuestroCatalogo) {
    const match = productosRelbase.get(row.sku);
    const codigoEmpresa = row.empresas?.codigo_interno ?? "?";
    if (match) {
      matched += 1;
      updates.push({ id: row.id, product_id_relbase: match.id });
    } else {
      unmatched += 1;
      unmatchedPorEmpresa[codigoEmpresa] = (unmatchedPorEmpresa[codigoEmpresa] ?? 0) + 1;
    }
  }

  console.log(`\nCruce contra nuestro catalogo (${nuestroCatalogo.length} SKUs):`);
  console.log(`  con match en Relbase: ${matched}`);
  console.log(`  sin match en Relbase: ${unmatched}`);
  console.log(`  sin match por empresa:`, unmatchedPorEmpresa);

  console.log(`\nActualizando product_id_relbase para ${updates.length} filas...`);
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const lote = updates.slice(i, i + BATCH);
    await Promise.all(
      lote.map((u) =>
        supabase
          .from("productos_catalogo")
          .update({ product_id_relbase: u.product_id_relbase, ultima_sincronizacion: new Date().toISOString() })
          .eq("id", u.id)
      )
    );
  }

  console.log("Listo.");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
