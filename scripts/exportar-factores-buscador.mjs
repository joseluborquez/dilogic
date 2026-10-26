/**
 * Exporta del buscador de precios, para cada codigo vendido, la compra con
 * que se costea y su factor (cuantas unidades de venta salen de una unidad
 * de compra: 180 huevos sueltos o 6 bandejas de 30 por caja). Lo usa
 * generar-mismo-producto.mts. Solo lectura sobre la base del buscador.
 *
 *   cd ~/Desktop/codex/buscador-productos-dilogic
 *   node --env-file=.env.local "<ruta>/dilogic/scripts/exportar-factores-buscador.mjs" factores.json
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const postgres = createRequire(`${process.cwd()}/`)("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const filas = await sql`
    select l.codigo, max(l.nombre) nombre, e.estado, e.provider_id,
           coalesce(e.codigo_compra, lower(e.descripcion_compra)) compra, e.descripcion_compra, e.factor
      from buscador.equivalencias e
      join buscador.venta_lineas l on l.nombre_norm = e.nombre_norm
     where l.codigo ~ '^(CERQ|MTX|YDR)_[A-Z]+_[0-9]+$'
     group by 1, 3, 4, 5, 6, 7`;
  writeFileSync(process.argv[2], JSON.stringify(filas, null, 1));
  console.log(`${filas.length} codigos exportados`);
} finally {
  await sql.end();
}
