// Genera src/lib/catalogo/catalogo-seed.json: catalogo de respaldo para
// desarrollo local mientras no existe un proyecto Supabase (ver
// src/lib/catalogo/validar.ts). Fuente: ../CODIGOS DILOGIC.xlsx.
//
// Uso: node scripts/generate-catalog-local-json.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSheet } from "read-excel-file/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.resolve(projectRoot, "..", "CODIGOS DILOGIC.xlsx");

const EMPRESAS = [
  { codigo_interno: "CERQ", sheet: "CERMAQ" },
  { codigo_interno: "MTX", sheet: "MULTI X" },
  { codigo_interno: "YDR", sheet: "YADRAN" },
];

async function main() {
  const catalogo = {};

  for (const empresa of EMPRESAS) {
    const sheetRows = await readSheet(catalogPath, empresa.sheet);
    const dataRows = sheetRows.slice(1);
    const productos = [];
    const seen = new Set();

    for (const row of dataRows) {
      const sku = row[1] != null ? String(row[1]).trim() : "";
      const descripcion = row[2] != null ? String(row[2]).trim() : null;
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      productos.push({ sku, descripcion });
    }

    catalogo[empresa.codigo_interno] = productos;
  }

  const outPath = path.join(projectRoot, "src", "lib", "catalogo", "catalogo-seed.json");
  writeFileSync(outPath, JSON.stringify(catalogo, null, 2), "utf8");
  const total = Object.values(catalogo).reduce((acc, arr) => acc + arr.length, 0);
  console.log(`OK: ${total} productos escritos en ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
