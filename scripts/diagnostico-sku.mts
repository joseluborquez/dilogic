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
// Usa el mismo cliente de Relbase que la app: comparte el token OAuth y su
// candado de renovacion, asi que correrlo no corta la conexion de produccion.
//
// Uso:
//   npm run script scripts/diagnostico-sku.mts MTX_AB_234 MTX_CC_165
//   npm run script scripts/diagnostico-sku.mts MTX_AB_234 --rapido   (omite el barrido)

import { buscarProductos, listarProductosPagina } from "@/lib/relbase/client";
import type { RelbaseProducto } from "@/lib/relbase/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/** Todo lo que no sea letra o numero se ignora, y sin distinguir mayusculas. */
function normalizar(codigo: string | null): string {
  return String(codigo ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function distancia(a: string, b: string): number {
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
function visible(codigo: string | null): string {
  return JSON.stringify(codigo);
}

const args = process.argv.slice(2);
const rapido = args.includes("--rapido");
const skus = args.filter((a) => !a.startsWith("--"));
if (skus.length === 0) {
  console.error("Uso: npm run script scripts/diagnostico-sku.mts MTX_AB_234 MTX_CC_165");
  process.exit(1);
}

const supabase = getSupabaseServiceClient();

const { data: empresas, error: errEmpresas } = await supabase
  .from("empresas")
  .select("id, codigo_interno");
if (errEmpresas || !empresas) throw new Error(`Supabase empresas: ${errEmpresas?.message}`);
const nombreEmpresa = new Map(empresas.map((e) => [e.id, e.codigo_interno]));

// ---- 1 y 2: por cada SKU, la base y la busqueda directa ----
for (const sku of skus) {
  console.log(`\n${"=".repeat(60)}\nSKU ${visible(sku)}\n${"=".repeat(60)}`);

  const { data: filas, error } = await supabase
    .from("productos_catalogo")
    .select(
      "sku, empresa_id, product_id_relbase, descripcion, descripcion_relbase, familia, activo, precio, ultima_sincronizacion"
    )
    .eq("sku", sku);
  if (error || !filas) throw new Error(`Supabase productos_catalogo: ${error?.message}`);

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
  try {
    const productos = await buscarProductos(sku);
    if (productos.length === 0) {
      console.log("    Relbase no devuelve NINGUN producto para esa busqueda.");
    }
    for (const p of productos) {
      const exacto = p.code === sku;
      const casi = !exacto && normalizar(p.code) === normalizar(sku);
      const marca = exacto ? "EXACTO" : casi ? "SOLO COINCIDE NORMALIZADO" : "otro";
      console.log(`    [${marca}] code=${visible(p.code)} id=${p.id} name=${p.name ?? ""}`);
    }
  } catch (err) {
    console.log(`    Relbase fallo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (!rapido) {
  // ---- 3: barrido del catalogo completo de Relbase ----
  console.log(`\n${"=".repeat(60)}\n[3] Barrido del catalogo completo de Relbase\n${"=".repeat(60)}`);
  const todos: RelbaseProducto[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const pagina = await listarProductosPagina(page);
    totalPages = pagina.meta.total_pages;
    todos.push(...pagina.data.products);
    if (page % 20 === 0) console.log(`  pagina ${page}/${totalPages}`);
    page += 1;
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
