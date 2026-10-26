/**
 * Carga en memoria_listados una propuesta de guia ya revisada (Excel con el
 * texto que pidio el cliente y el codigo elegido), para que el proximo
 * listado salga "Aprendido". Sin «escribir» solo muestra lo que cargaria.
 *
 *   npm run script scripts/cargar-memoria-propuesta.mts "<archivo.xlsx>" [escribir]
 *
 * Columnas: la del pedido del cliente ("Pedido ...") y "Código relBase".
 */
import { readFileSync } from "node:fs";
import { leerLibro } from "@/lib/excel/libro";
import { claveMemoria } from "@/lib/listado-cliente/cruce";
import { recordar } from "@/lib/guia-manual/memoria";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

const [archivo, bandera] = process.argv.slice(2);
const hojas = await leerLibro(readFileSync(archivo));
const esCabecera = (f: unknown[]) => f.some((c) => /^pedido/i.test(String(c ?? "")));
const hoja = hojas.find((h) => !h.oculta && h.data.some(esCabecera));
if (!hoja) throw new Error("No hay una hoja con columna «Pedido …».");
const iCab = hoja.data.findIndex(esCabecera);
const cab = hoja.data[iCab].map((c) => String(c ?? "").trim().toLowerCase());
const iTexto = cab.findIndex((c) => c.startsWith("pedido"));
const iCodigo = cab.findIndex((c) => c.startsWith("código") || c.startsWith("codigo"));

const pares = hoja.data
  .slice(iCab + 1)
  .map((f) => ({ texto: String(f[iTexto] ?? "").trim(), codigo: String(f[iCodigo] ?? "").trim().toUpperCase() }))
  .filter((p) => p.texto && p.codigo);

// El id de producto se toma de las guias ya emitidas o del catalogo.
const codigos = [...new Set(pares.map((p) => p.codigo))];
const supabase = getSupabaseServiceClient();
const [{ data: cat }, { data: ven }] = await Promise.all([
  supabase.from("productos_catalogo").select("sku, product_id_relbase").in("sku", codigos),
  supabase.from("ventas_lineas").select("codigo, product_id").in("codigo", codigos).not("product_id", "is", null),
]);
const id = new Map<string, number>();
for (const v of ven ?? []) id.set(v.codigo!, Number(v.product_id));
for (const c of cat ?? []) if (c.product_id_relbase) id.set(c.sku, Number(c.product_id_relbase));

const claves = new Map(pares.map((p) => [claveMemoria(p.texto), p]));
console.log(
  `${pares.length} líneas → ${claves.size} textos distintos; ${pares.filter((p) => p.codigo === "O-PG-166053").length} genéricos; sin id de producto: ${codigos.filter((c) => !id.has(c)).join(", ") || "ninguno"}`
);
for (const p of [...claves.values()].slice(0, 4)) console.log(`  «${p.texto}» → ${p.codigo}`);

if (bandera === "escribir") {
  await recordar(
    [...claves.values()].map((p) => ({ ...p, productId: id.get(p.codigo) ?? null })),
    "carga inicial: propuesta Grip Nord"
  );
  const { count } = await supabase.from("memoria_listados").select("*", { count: "exact", head: true });
  console.log(`memoria_listados tiene ${count} textos.`);
}
