// Sincroniza product_id_relbase Y precio (campo "price", confirmado contra
// guias reales) para todo productos_catalogo. Para los SKUs que no aparecen
// en el listado paginado completo, hace una busqueda directa por codigo
// (GET /productos?query=<code>) como respaldo, ya que la paginacion de
// Relbase tiene huecos conocidos (ver hallazgo 09-jul-2026). Solo lectura
// hacia Relbase.
//
// Uso: node scripts/sync-catalogo-relbase-completo.mjs

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
  const productosRelbase = new Map(); // code -> {id, price}
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(`${BASE_URL}/productos?page=${page}`, { headers });
    if (!res.ok) throw new Error(`Relbase respondio ${res.status} en pagina ${page}`);
    const json = await res.json();
    totalPages = json.meta.total_pages;
    for (const p of json.data.products) {
      if (!p.code) continue;
      productosRelbase.set(p.code, { id: p.id, price: p.price });
    }
    if (page % 30 === 0 || page === totalPages) console.log(`  pagina ${page}/${totalPages}...`);
    page += 1;
    await new Promise((r) => setTimeout(r, 1000 / MAX_REQ_PER_SECOND));
  } while (page <= totalPages);

  console.log(`Total codigos unicos via paginacion: ${productosRelbase.size}`);

  const { data: nuestroCatalogo, error } = await supabase
    .from("productos_catalogo")
    .select("id, sku");
  if (error) throw error;

  const updates = [];
  const sinMatchTrasPaginacion = [];

  for (const row of nuestroCatalogo) {
    const match = productosRelbase.get(row.sku);
    if (match) {
      updates.push({ id: row.id, product_id_relbase: match.id, precio: match.price });
    } else {
      sinMatchTrasPaginacion.push(row);
    }
  }

  console.log(`Sin match tras paginacion: ${sinMatchTrasPaginacion.length}. Buscando directo por codigo...`);
  for (const row of sinMatchTrasPaginacion) {
    const res = await fetch(`${BASE_URL}/productos?query=${encodeURIComponent(row.sku)}`, { headers });
    const json = await res.json();
    const p = json.data.products.find((p) => p.code === row.sku);
    if (p) {
      updates.push({ id: row.id, product_id_relbase: p.id, precio: p.price });
      console.log(`  encontrado por busqueda directa: ${row.sku} -> id ${p.id}, price ${p.price}`);
    } else {
      console.log(`  SIGUE SIN ENCONTRARSE: ${row.sku}`);
    }
    await new Promise((r) => setTimeout(r, 1000 / MAX_REQ_PER_SECOND));
  }

  console.log(`\nActualizando ${updates.length} filas en productos_catalogo...`);
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const lote = updates.slice(i, i + BATCH);
    await Promise.all(
      lote.map((u) =>
        supabase
          .from("productos_catalogo")
          .update({
            product_id_relbase: u.product_id_relbase,
            precio: u.precio,
            ultima_sincronizacion: new Date().toISOString(),
          })
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
