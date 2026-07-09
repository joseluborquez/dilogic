// Genera supabase/seed.sql a partir de ../CODIGOS DILOGIC.xlsx (fuente de verdad
// del catalogo, ver CLAUDE.md). No requiere Supabase activo: solo produce SQL
// para aplicar despues.
//
// Uso: node scripts/generate-catalog-seed.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSheet } from "read-excel-file/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.resolve(projectRoot, "..", "CODIGOS DILOGIC.xlsx");

const EMPRESAS = [
  { nombre: "Cermaq", codigo_interno: "CERQ", sheet: "CERMAQ" },
  { nombre: "Multiexport", codigo_interno: "MTX", sheet: "MULTI X" },
  { nombre: "Yadran", codigo_interno: "YDR", sheet: "YADRAN" },
];

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const rows = [];

  for (const empresa of EMPRESAS) {
    const sheetRows = await readSheet(catalogPath, empresa.sheet);
    // Fila 1 = encabezado (CODIGO, Descripcion/Nombre/PRODUCTO, CANTIDAD)
    const dataRows = sheetRows.slice(1);
    const seen = new Set();

    for (const row of dataRows) {
      const sku = row[1] != null ? String(row[1]).trim() : "";
      const descripcion = row[2] != null ? String(row[2]).trim() : null;
      if (!sku) continue;
      if (seen.has(sku)) {
        console.warn(`[${empresa.codigo_interno}] SKU duplicado dentro de la hoja, se omite repetido: ${sku}`);
        continue;
      }
      seen.add(sku);
      rows.push({ codigo_interno: empresa.codigo_interno, sku, descripcion });
    }
  }

  const empresasSql = EMPRESAS.map(
    (e) => `  (${sqlString(e.nombre)}, ${sqlString(e.codigo_interno)})`
  ).join(",\n");

  const catalogoValuesSql = rows
    .map((r) => `  (${sqlString(r.codigo_interno)}, ${sqlString(r.sku)}, ${sqlString(r.descripcion)})`)
    .join(",\n");

  const sql = `-- Generado por scripts/generate-catalog-seed.mjs a partir de
-- "../CODIGOS DILOGIC.xlsx" (fuente de verdad del catalogo, ver CLAUDE.md).
-- product_id_relbase queda en null: se completa recien cuando exista el token
-- de usuario integrador y se corra la sincronizacion contra
-- GET /api/v1/productos.

insert into empresas (nombre, codigo_interno)
values
${empresasSql}
on conflict (codigo_interno) do nothing;

insert into productos_catalogo (empresa_id, sku, descripcion)
select e.id, v.sku, v.descripcion
from (values
${catalogoValuesSql}
) as v(codigo_interno, sku, descripcion)
join empresas e on e.codigo_interno = v.codigo_interno
on conflict (empresa_id, sku) do update set descripcion = excluded.descripcion;
`;

  const outPath = path.join(projectRoot, "supabase", "seed.sql");
  writeFileSync(outPath, sql, "utf8");
  console.log(`OK: ${rows.length} productos escritos en ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
