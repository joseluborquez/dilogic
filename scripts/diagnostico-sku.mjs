// Diagnostica por que un SKU queda "sin match" aunque se sincronice el
// catalogo una y otra vez. Solo lectura (nunca escribe ni en Supabase ni en
// Relbase).
//
// Para cada SKU responde tres preguntas, en orden:
//   1. Esta la fila en productos_catalogo? Con que product_id_relbase?
//   2. Lo devuelve Relbase con GET /productos?query=<sku> (la busqueda que usa
//      la sincronizacion de pendientes)?
//   3. Existe en ALGUNA pagina del catalogo completo de Relbase, aunque el
//      codigo este escrito distinto (espacios, mayusculas, guiones, ceros a la
//      izquierda)?
//
// Uso:
//   node scripts/diagnostico-sku.mjs MTX_AB_234 MTX_CC_165
//   node scripts/diagnostico-sku.mjs MTX_AB_234 --rapido   (omite el barrido)

import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const BASE_URL = "https://api.relbase.cl/api/v1";

function loadEnvLocal(archivo = ".env.local") {
  const content = readFileSync(path.resolve(projectRoot, archivo), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(idx + 1).trim();
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

/** Todo lo que no sea letra o numero se ignora, y sin distinguir mayusculas. */
function normalizar(codigo) {
  return String(codigo ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function distancia(a, b) {
  const filaPrevia = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = filaPrevia[0];
    filaPrevia[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = filaPrevia[j];
      filaPrevia[j] = Math.min(
        filaPrevia[j] + 1,
        filaPrevia[j - 1] + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      anterior = guardado;
    }
  }
  return filaPrevia[b.length];
}

/** Muestra el codigo con comillas para que se vean espacios invisibles. */
function visible(codigo) {
  return JSON.stringify(codigo);
}

function paginasTotales(json) {
  return json?.meta?.total_pages ?? json?.data?.last_page ?? json?.meta?.last_page ?? 1;
}

async function main() {
  const args = process.argv.slice(2);
  const rapido = args.includes("--rapido");
  // --env <ruta> por si el archivo de credenciales no se llama .env.local.
  const idxEnv = args.indexOf("--env");
  loadEnvLocal(idxEnv === -1 ? ".env.local" : args[idxEnv + 1]);
  const skus = args.filter((a, i) => !a.startsWith("--") && i !== idxEnv + 1);
  if (skus.length === 0) {
    console.error("Uso: node scripts/diagnostico-sku.mjs MTX_AB_234 MTX_CC_165");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: empresas, error: errEmpresas } = await supabase
    .from("empresas")
    .select("id, codigo_interno, activo");
  if (errEmpresas) throw new Error(`Supabase empresas: ${errEmpresas.message}`);
  const nombreEmpresa = new Map(empresas.map((e) => [e.id, e.codigo_interno]));

  const activa = empresas.find((e) => e.activo);
  if (!activa) throw new Error("No hay empresas activas configuradas.");
  const { data: cred, error: errCred } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .eq("empresa_id", activa.id)
    .single();
  if (errCred || !cred) throw new Error("No hay credenciales de Relbase para esa empresa.");

  const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  const headers = {
    company: decryptToken(cred.token_empresa, encryptionKey),
    authorization: decryptToken(cred.token_usuario_integrador, encryptionKey),
    "Content-Type": "application/json",
  };

  // ---- 1 y 2: por cada SKU, la base y la busqueda directa ----
  for (const sku of skus) {
    console.log(`\n${"=".repeat(60)}\nSKU ${visible(sku)}\n${"=".repeat(60)}`);

    const { data: filas, error } = await supabase
      .from("productos_catalogo")
      .select("sku, empresa_id, product_id_relbase, descripcion, descripcion_relbase, familia, activo, precio, ultima_sincronizacion")
      .eq("sku", sku);
    if (error) throw new Error(`Supabase productos_catalogo: ${error.message}`);

    console.log("\n[1] productos_catalogo");
    if (filas.length === 0) {
      console.log("    NO EXISTE ninguna fila con ese sku (en ninguna empresa).");
      console.log("    -> el error seria 'El codigo no existe en el catalogo de esta empresa'.");
      console.log("    -> falta cargarlo en Catalogo > importar Excel de la empresa.");
    }
    for (const f of filas) {
      console.log(`    empresa=${nombreEmpresa.get(f.empresa_id) ?? f.empresa_id}`);
      console.log(`    product_id_relbase=${f.product_id_relbase ?? "NULL  <-- por esto falla"}`);
      console.log(`    descripcion=${f.descripcion ?? "(sin descripcion)"}`);
      console.log(`    familia=${f.familia} activo=${f.activo} precio=${f.precio}`);
      console.log(`    ultima_sincronizacion=${f.ultima_sincronizacion ?? "nunca"}`);
    }

    console.log("\n[2] GET /productos?query=<sku>  (lo que usa la sincronizacion)");
    const res = await fetch(`${BASE_URL}/productos?query=${encodeURIComponent(sku)}`, { headers });
    if (!res.ok) {
      console.log(`    Relbase respondio ${res.status}`);
    } else {
      const json = await res.json();
      const productos = json.data?.products ?? [];
      if (productos.length === 0) {
        console.log("    Relbase no devuelve NINGUN producto para esa busqueda.");
      }
      for (const p of productos) {
        const exacto = p.code === sku;
        const casi = !exacto && normalizar(p.code) === normalizar(sku);
        const marca = exacto ? "EXACTO" : casi ? "SOLO COINCIDE NORMALIZADO" : "otro";
        console.log(`    [${marca}] code=${visible(p.code)} id=${p.id} name=${p.name ?? ""}`);
      }
    }
    await new Promise((r) => setTimeout(r, 150)); // ~7 req/s
  }

  if (rapido) return;

  // ---- 3: barrido del catalogo completo de Relbase ----
  console.log(`\n${"=".repeat(60)}\n[3] Barrido del catalogo completo de Relbase\n${"=".repeat(60)}`);
  const todos = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(`${BASE_URL}/productos?page=${page}`, { headers });
    if (!res.ok) throw new Error(`Relbase ${res.status} en pagina ${page}`);
    const json = await res.json();
    totalPages = paginasTotales(json);
    for (const p of json.data?.products ?? []) todos.push(p);
    if (page % 20 === 0) process.stdout.write(`  pagina ${page}/${totalPages}\n`);
    page += 1;
    await new Promise((r) => setTimeout(r, 150));
  } while (page <= totalPages);
  console.log(`  ${todos.length} productos en ${totalPages} paginas.\n`);

  for (const sku of skus) {
    const objetivo = normalizar(sku);
    const exacto = todos.filter((p) => p.code === sku);
    const normalizados = todos.filter((p) => p.code !== sku && normalizar(p.code) === objetivo);
    const cercanos = todos
      .filter((p) => normalizar(p.code) !== objetivo && distancia(normalizar(p.code), objetivo) <= 2)
      .slice(0, 10);

    console.log(`SKU ${visible(sku)}`);
    if (exacto.length > 0) {
      for (const p of exacto) {
        console.log(`  EXISTE con el codigo exacto: id=${p.id} name=${p.name ?? ""}`);
      }
      console.log("  -> el codigo si esta en Relbase; el problema es de la sincronizacion, no del dato.");
    } else if (normalizados.length > 0) {
      for (const p of normalizados) {
        console.log(`  EXISTE pero escrito distinto: code=${visible(p.code)} id=${p.id} name=${p.name ?? ""}`);
      }
      console.log("  -> corregir el codigo en Relbase (o en el catalogo) para que sean identicos.");
    } else {
      console.log("  NO existe en el catalogo de Relbase.");
      if (cercanos.length > 0) {
        console.log("  Codigos parecidos encontrados:");
        for (const p of cercanos) {
          console.log(`    code=${visible(p.code)} id=${p.id} name=${p.name ?? ""}`);
        }
      }
      console.log("  -> hay que crear el producto en Relbase (o usar el codigo correcto).");
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
