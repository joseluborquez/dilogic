/**
 * Exporta del buscador de precios los grupos "misma compra" que usa
 * generar-equivalencias.mts. Solo lectura sobre la base del buscador.
 *
 *   cd ~/Desktop/codex/buscador-productos-dilogic
 *   node --env-file=.env.local "<ruta>/dilogic/scripts/exportar-vinculos-buscador.mjs" vinculos.json
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const postgres = createRequire(`${process.cwd()}/`)("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  // Producto vendido (por su codigo en las guias desde julio) -> compra con que se costea y su factor.
  const filas = await sql`
    select e.estado, e.provider_id, coalesce(e.codigo_compra, lower(e.descripcion_compra)) compra,
           e.descripcion_compra, e.factor, l.codigo, max(l.nombre) nombre
      from buscador.equivalencias e
      join buscador.venta_lineas l on l.nombre_norm = e.nombre_norm
      join buscador.ventas v on v.dte_id = l.dte_id and v.fecha >= '2026-07-01'
     where l.codigo ~ '^(CERQ|MTX|YDR)_[A-Z]+_[0-9]+$'
     group by 1, 2, 3, 4, 5, 6`;
  const grupos = new Map();
  for (const f of filas) {
    const k = `${f.provider_id}|${f.compra}`;
    if (!grupos.has(k)) grupos.set(k, { compra: f.descripcion_compra, estado: new Set(), codigos: {} });
    const g = grupos.get(k);
    g.estado.add(f.estado);
    g.codigos[f.codigo] = { nombre: f.nombre, factor: Number(f.factor) };
  }
  const salida = [...grupos.values()]
    .filter((g) => new Set(Object.keys(g.codigos).map((c) => c.split("_")[0])).size >= 2)
    .map((g) => ({ ...g, estado: [...g.estado] }));
  writeFileSync(process.argv[2], JSON.stringify(salida, null, 1));
  console.log(`${salida.length} grupos exportados`);
} finally {
  await sql.end();
}
