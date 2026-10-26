/**
 * Cruce del listado Excel de un cliente externo con el catalogo (paso 5).
 * Sin dependencias de servidor: corre en la pantalla para que cambiar de
 * columna o de opcion de precio sea instantaneo.
 *
 * Cada linea del cliente se compara por palabras con los productos de
 * Cermaq, Multiexport y Yadran (tolera plurales, tildes y abreviaturas de
 * envase) y por tamano (400 g, 1 kg, 1,5 L). Entre equivalentes de distintas
 * empresas queda uno solo como candidato; la opcion de precio decide despues
 * con resolverLinea, igual que en la guia manual.
 */
import { NOMBRE_EMPRESA, PRODUCTO_GENERICO, equivalentesDe, resolverLinea, type LineaResuelta, type OpcionPrecio, type ProductoGuia } from "@/lib/guia-manual/resolver";

/** Puntaje desde el que la propuesta se acepta sin revisar. */
export const PARECIDO_SEGURO = 0.75;
/** Bajo este puntaje no se propone producto: va como genérico. */
export const PARECIDO_MINIMO = 0.45;
const MAX_CANDIDATOS = 5;

export interface FilaListado {
  /** Fila en el Excel del cliente (1 = primera fila de la hoja). */
  fila: number;
  texto: string;
  codigo: string | null;
  cantidad: number | null;
  /** Lo que venia en la celda de cantidad, para mostrarlo si no era un numero. */
  cantidadOriginal: string;
  unidad: string | null;
  /** Precio neto unitario que trae el listado; si viene, manda sobre la opcion de precio. */
  precio?: number | null;
}

export interface Candidato {
  producto: ProductoGuia;
  /** 0 a 1. */
  parecido: number;
  /** El listado traia este codigo: se usa tal cual, sin aplicar la opcion de precio. */
  porCodigo?: boolean;
}

export type EstadoCruce = "ok" | "revisar" | "sin-calce";

export interface Cruce {
  fila: FilaListado;
  /** Mejor primero; uno por grupo de equivalentes. */
  candidatos: Candidato[];
  /** El producto con que se arma la linea (null = genérico). */
  elegido: ProductoGuia | null;
  /** La linea con la opcion de precio aplicada; null sin opcion. */
  resuelta: LineaResuelta | null;
  estado: EstadoCruce;
  dudas: string[];
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

// Envases, unidades sueltas y palabras de relleno: no distinguen productos.
const RELLENO = new Set(
  "de del la las el los en con sin y x o para por un una und unid unidad unidade c u cu ud uds unidades unids kilo kilos pack aprox pqte paquete paq tarro tar bot botella frasco fco sobre bolsa bol caja cj pote envase bandeja band kg kilo kgs gr grs g lt lts l litro cc ml mt nac n nº no".split(" ")
);

const TAMANO = /(\d+(?:\.\d+)?)\s*(kilos?|kgs?|gramos?|grs?|g|litros?|lts?|l|cc|ml)\b/g;

export function normalizarTexto(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .trim();
}

/** Clave de la memoria: el texto del cliente normalizado ("Huevos  Bandeja x30" -> "huevos bandeja x30"). */
export function claveMemoria(texto: string): string {
  return normalizarTexto(texto).replace(/\s+/g, " ").trim();
}

/** Tamanos en gramos (g:) o mililitros (ml:). "1 kg" y "1000 g" son iguales. */
function tamanos(normalizado: string): Set<string> {
  const salida = new Set<string>();
  for (const [, n, u] of normalizado.matchAll(TAMANO)) {
    const valor = Number(n);
    if (/^k/.test(u)) salida.add(`g:${valor * 1000}`);
    else if (/^g/.test(u)) salida.add(`g:${valor}`);
    else if (/^(l|lt|lts|litros?)$/.test(u)) salida.add(`ml:${valor * 1000}`);
    else salida.add(`ml:${valor}`);
  }
  return salida;
}

/** Raiz corta y pareja para los dos lados: limones/limon, surtidas/surtidos. */
function raiz(w: string): string {
  if (/^\d/.test(w)) return w;
  let r = w;
  if (r.length > 4) r = r.replace(/(es|s)$/, "");
  if (r.length > 4) r = r.replace(/[aeo]$/, "");
  return r;
}

/** Una palabra con su raiz (para igualar plurales) y como se escribio (para abreviaturas). */
interface Palabra {
  r: string;
  o: string;
}

function palabras(normalizado: string): Palabra[] {
  const sinTamanos = normalizado.replace(TAMANO, " ");
  const vistas = new Map<string, Palabra>();
  for (const o of sinTamanos.split(" ")) {
    if (!o || RELLENO.has(o)) continue;
    const r = raiz(o);
    if (!vistas.has(r)) vistas.set(r, { r, o });
  }
  return [...vistas.values()];
}

/**
 * 1 = misma raiz; 0.8 = una abrevia a la otra ("det" / "detergente") o
 * difiere en una letra. Las abreviaturas se miran en la palabra completa, no
 * en la raiz: la raiz de "leche" ("lech") es el comienzo de "lechuga".
 */
function parecidoPalabra(a: Palabra, b: Palabra): number {
  if (a.r === b.r) return 1;
  if (/^\d/.test(a.r) || /^\d/.test(b.r)) return 0;
  const [corta, larga] = a.o.length <= b.o.length ? [a.o, b.o] : [b.o, a.o];
  // Abreviatura de 3 letras solo para palabras largas: "det" es detergente, pero "sal" no es salsa.
  if ((corta.length >= 4 || (corta.length === 3 && larga.length >= 7)) && larga.startsWith(corta)) return 0.8;
  if (corta.length >= 5 && larga.length - corta.length <= 1 && distanciaUno(corta, larga)) return 0.8;
  return 0;
}

function distanciaUno(a: string, b: string): boolean {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.length === b.length ? a.slice(i + 1) === b.slice(i + 1) : a.slice(i) === b.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Indice del catalogo
// ---------------------------------------------------------------------------

interface Entrada {
  producto: ProductoGuia;
  palabras: Palabra[];
  tamanos: Set<string>;
}

export interface IndiceCatalogo {
  entradas: Entrada[];
  entradaDe: Map<string, Entrada>;
  porCodigo: Map<string, ProductoGuia>;
  /** Peso de cada palabra: las que aparecen en muchos productos valen menos. */
  peso: (w: Palabra) => number;
}

export function indexarCatalogo(productos: ProductoGuia[]): IndiceCatalogo {
  const entradas = productos.map((p) => {
    const n = normalizarTexto(p.nombre);
    return { producto: p, palabras: palabras(n), tamanos: tamanos(n) };
  });
  const frecuencia = new Map<string, number>();
  for (const e of entradas) for (const w of e.palabras) frecuencia.set(w.r, (frecuencia.get(w.r) ?? 0) + 1);
  const total = Math.max(entradas.length, 1);
  return {
    entradas,
    entradaDe: new Map(entradas.map((e) => [e.producto.codigo, e])),
    porCodigo: new Map(productos.map((p) => [p.codigo.toUpperCase(), p])),
    peso: (w) => Math.log(1 + total / (1 + (frecuencia.get(w.r) ?? 0))),
  };
}

function puntuar(linea: Palabra[], tamLinea: Set<string>, e: Entrada, peso: (w: Palabra) => number): { parecido: number; tamanoDistinto: boolean } {
  if (linea.length === 0 || e.palabras.length === 0) return { parecido: 0, tamanoDistinto: false };
  const esNumero = (w: Palabra) => /^\d/.test(w.r);
  let calzaLinea = 0;
  for (const w of linea) calzaLinea += peso(w) * Math.max(0, ...e.palabras.map((p) => parecidoPalabra(w, p)));
  let calzaProducto = 0;
  for (const p of e.palabras) calzaProducto += peso(p) * Math.max(0, ...linea.map((w) => parecidoPalabra(w, p)));
  const totalLinea = linea.reduce((s, w) => s + peso(w), 0);
  const totalProducto = e.palabras.reduce((s, w) => s + peso(w), 0);
  let parecido = (calzaLinea + calzaProducto) / (totalLinea + totalProducto);

  // La primera palabra del pedido suele ser el producto: "GALLETAS de
  // mantequilla" no es mantequilla, "FRUTOS rojos" no es pimiento rojo.
  const nucleo = linea.find((w) => !esNumero(w));
  if (nucleo && !e.palabras.some((p) => parecidoPalabra(nucleo, p) > 0)) parecido *= 0.6;

  // "Arroz grado 2" no es "Arroz grado 1": un numero suelto distinto cuenta como formato distinto.
  const numLinea = linea.filter(esNumero);
  const numProducto = e.palabras.filter(esNumero);
  let tamanoDistinto = numLinea.length > 0 && numProducto.length > 0 && !numLinea.some((n) => numProducto.some((m) => m.r === n.r));
  if (tamanoDistinto) parecido *= 0.85;
  // Un numero que el cliente escribio y el producto no tiene: dejarlo para revisar.
  else if (numLinea.length > 0 && numProducto.length === 0) parecido *= 0.9;
  if (tamLinea.size > 0 && e.tamanos.size > 0) {
    if ([...tamLinea].some((t) => e.tamanos.has(t))) parecido = Math.min(1, parecido + 0.1);
    else {
      parecido *= 0.75;
      tamanoDistinto = true;
    }
  }
  return { parecido, tamanoDistinto };
}

/**
 * Grupos de "mismo producto, mismo formato" entre las tres empresas para todo
 * el catalogo: las equivalencias guardadas mas los pares de empresas distintas
 * cuyos nombres se parecen entre si (>= 0.8 en ambos sentidos) y con el mismo
 * tamano. A lo mas un codigo por empresa en cada grupo. Se calcula una vez.
 */
export function agruparMismoProducto(indice: IndiceCatalogo, extra: (codigo: string) => string[] = equivalentesDe): Map<string, string[]> {
  // Fuera los codigos que cubren dos productos ("POSTA ROSADA Ó NEGRA"): no son el mismo que ninguno.
  const oficiales = indice.entradas.filter((e) => e.producto.empresa != null && !/\s[oó]\s/i.test(e.producto.nombre));
  const padre = new Map<string, string>(oficiales.map((e) => [e.producto.codigo, e.producto.codigo]));
  const raiz = (x: string): string => {
    const p = padre.get(x) ?? x;
    if (p === x) return x;
    const r = raiz(p);
    padre.set(x, r);
    return r;
  };
  const miembros = new Map<string, string[]>(oficiales.map((e) => [e.producto.codigo, [e.producto.codigo]]));
  const empresa = (c: string) => c.split("_")[0];
  const unir = (a: string, b: string) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra === rb || !padre.has(a) || !padre.has(b)) return;
    const ea = new Set(miembros.get(ra)!.map(empresa));
    if (miembros.get(rb)!.some((c) => ea.has(empresa(c)))) return;
    padre.set(rb, ra);
    miembros.set(ra, [...miembros.get(ra)!, ...miembros.get(rb)!]);
  };
  for (const e of oficiales) for (const c of extra(e.producto.codigo)) unir(e.producto.codigo, c);
  for (let i = 0; i < oficiales.length; i += 1) {
    const a = oficiales[i];
    for (let j = i + 1; j < oficiales.length; j += 1) {
      const b = oficiales[j];
      if (a.producto.empresa === b.producto.empresa || a.producto.familia !== b.producto.familia) continue;
      const ida = puntuar(a.palabras, a.tamanos, b, indice.peso);
      if (ida.parecido < 0.8 || ida.tamanoDistinto) continue;
      if (puntuar(b.palabras, b.tamanos, a, indice.peso).parecido >= 0.8) unir(a.producto.codigo, b.producto.codigo);
    }
  }
  const grupos = new Map<string, string[]>();
  for (const e of oficiales) grupos.set(e.producto.codigo, miembros.get(raiz(e.producto.codigo))!);
  return grupos;
}

// ---------------------------------------------------------------------------
// Cruce
// ---------------------------------------------------------------------------

const CODIGO_CATALOGO = /\b(CERQ|MTX|YDR)_[A-Z]+_\d+\b/i;

/** Candidatos para una linea, mejor primero, uno por grupo de equivalentes. */
export function buscarCandidatos(fila: FilaListado, indice: IndiceCatalogo): { candidatos: Candidato[]; tamanoDistinto: Set<string> } {
  // Codigo en su columna (cualquier codigo de Relbase: A-AD-124343, TTF_005...)
  // o uno del catalogo escrito dentro del texto.
  const codigo = (fila.codigo?.trim() || fila.texto.match(CODIGO_CATALOGO)?.[0] || "").toUpperCase();
  const exacto = codigo ? indice.porCodigo.get(codigo) : undefined;
  if (exacto) return { candidatos: [{ producto: exacto, parecido: 1, porCodigo: true }], tamanoDistinto: new Set() };

  const n = normalizarTexto(fila.texto);
  const linea = palabras(n);
  const tamLinea = tamanos(n);
  const tamanoDistinto = new Set<string>();
  const mejorPorGrupo = new Map<string, Candidato>();
  for (const e of indice.entradas) {
    const { parecido, tamanoDistinto: distinto } = puntuar(linea, tamLinea, e, indice.peso);
    if (parecido < 0.2) continue;
    if (distinto) tamanoDistinto.add(e.producto.codigo);
    const grupo = equivalentesDe(e.producto.codigo).join("|");
    const actual = mejorPorGrupo.get(grupo);
    if (!actual || parecido > actual.parecido) mejorPorGrupo.set(grupo, { producto: e.producto, parecido });
  }
  // Primero el catalogo oficial (Cermaq, Multiexport, Yadran); los productos
  // creados en Relbase solo se proponen si ahi no hay nada parecido.
  const todos = [...mejorPorGrupo.values()].sort((a, b) => b.parecido - a.parecido);
  const oficiales = todos.filter((c) => c.producto.empresa != null);
  const creados = todos.filter((c) => c.producto.empresa == null);
  const candidatos =
    oficiales[0] && oficiales[0].parecido >= PARECIDO_MINIMO
      ? [...oficiales.slice(0, MAX_CANDIDATOS), ...creados.slice(0, 2)]
      : [...creados.slice(0, 3), ...oficiales.slice(0, MAX_CANDIDATOS)].sort((a, b) => Number(b.parecido >= PARECIDO_MINIMO) - Number(a.parecido >= PARECIDO_MINIMO));
  return { candidatos, tamanoDistinto };
}

/**
 * Dos candidatos casi igual de parecidos, de empresas distintas y del mismo
 * tamano, son el mismo producto aunque no esten en las equivalencias ("ASADO
 * DE TIRA Kg." de Cermaq y "ASADO DE TIRA VACUNO 1 KG" de Multiexport).
 */
function mismoProductoOtraEmpresa(a: Candidato, b: Candidato, tamanoDistinto: Set<string>, indice: IndiceCatalogo): boolean {
  if (a.producto.empresa == null || b.producto.empresa == null || a.producto.empresa === b.producto.empresa) return false;
  if (b.parecido < PARECIDO_MINIMO || tamanoDistinto.has(a.producto.codigo) || tamanoDistinto.has(b.producto.codigo)) return false;
  // Se comparan los nombres entre si, no contra el pedido: "ASADO DE TIRA Kg." y
  // "ASADO DE TIRA VACUNO 1 KG" son el mismo aunque el cliente escriba de mas.
  const ea = indice.entradaDe.get(a.producto.codigo);
  const eb = indice.entradaDe.get(b.producto.codigo);
  if (!ea || !eb) return false;
  const ida = puntuar(ea.palabras, ea.tamanos, eb, indice.peso);
  const vuelta = puntuar(eb.palabras, eb.tamanos, ea, indice.peso);
  return !ida.tamanoDistinto && Math.min(ida.parecido, vuelta.parecido) >= 0.8;
}

/**
 * La opcion de precio sobre el producto elegido, sus equivalentes y los
 * candidatos que son el mismo producto en otra empresa: asi "precio mas alto"
 * compara todo lo que de verdad es el mismo producto.
 */
function resolverConCercanos(
  elegido: ProductoGuia,
  opcion: OpcionPrecio,
  candidatos: Candidato[],
  tamanoDistinto: Set<string>,
  indice: IndiceCatalogo
): LineaResuelta {
  const base = candidatos.find((c) => c.producto.codigo === elegido.codigo);
  const cercanos = base ? candidatos.filter((c) => c !== base && mismoProductoOtraEmpresa(base, c, tamanoDistinto, indice)) : [];
  if (cercanos.length === 0) return resolverLinea(elegido, opcion, indice.porCodigo);

  const pool = new Map<string, ProductoGuia>();
  for (const c of [elegido, ...cercanos.map((x) => x.producto)])
    for (const cod of equivalentesDe(c.codigo)) {
      const p = indice.porCodigo.get(cod.toUpperCase());
      if (p) pool.set(p.codigo, p);
    }
  const productos = [...pool.values()];
  const tal = (p: ProductoGuia, motivo: string): LineaResuelta => ({ productId: p.productId, codigo: p.codigo, nombre: p.nombre, descripcion: null, precio: p.precio, esGenerico: false, motivo });
  const empresas = (ps: ProductoGuia[]) => [...new Set(ps.map((p) => NOMBRE_EMPRESA[p.empresa ?? ""] ?? p.codigo))].join(", ");

  if (opcion === "alto" || opcion === "bajo") {
    const conPrecio = productos.filter((p) => p.precio != null);
    if (conPrecio.length === 0) return tal(elegido, "sin precio de referencia");
    const p = conPrecio.reduce((a, b) => (opcion === "alto" ? (b.precio! > a.precio! ? b : a) : b.precio! < a.precio! ? b : a));
    return tal(p, `el ${opcion === "alto" ? "más alto" : "más bajo"} de ${conPrecio.length} (${empresas(conPrecio)})`);
  }
  const deEsaEmpresa = productos.find((p) => p.empresa === opcion);
  return deEsaEmpresa ? tal(deEsaEmpresa, `de ${NOMBRE_EMPRESA[opcion]}`) : resolverLinea(elegido, opcion, indice.porCodigo);
}

/**
 * Arma la propuesta de una linea. `elegidoManual`: el producto que el usuario
 * eligio en pantalla (undefined = el sugerido; null = genérico). `busqueda`:
 * los candidatos ya calculados, para no repetir la busqueda en cada cambio.
 */
export function cruzarFila(
  fila: FilaListado,
  indice: IndiceCatalogo,
  opcion: OpcionPrecio | null,
  elegidoManual?: ProductoGuia | null,
  busqueda: ReturnType<typeof buscarCandidatos> = buscarCandidatos(fila, indice),
  /** La eleccion viene de la memoria (se uso antes con este texto): se aplica la opcion de precio como a una propuesta propia. */
  porMemoria = false
): Cruce {
  const { candidatos, tamanoDistinto } = busqueda;
  const dudas: string[] = [];
  const mejor = candidatos[0];
  const manual = elegidoManual !== undefined;

  // El listado ya dice "producto generico": va como generico con el texto de la linea.
  const genericoIndicado = !manual && mejor?.porCodigo === true && mejor.producto.codigo === PRODUCTO_GENERICO.codigo;

  let elegido: ProductoGuia | null;
  if (manual) elegido = elegidoManual;
  else if (genericoIndicado) elegido = null;
  else elegido = mejor && mejor.parecido >= PARECIDO_MINIMO ? mejor.producto : null;

  if (genericoIndicado) {
    if (fila.precio == null) dudas.push("Va como producto genérico, como indica el listado: falta el precio.");
  } else if (!manual) {
    if (!elegido) {
      dudas.push(mejor ? `Ningún producto se parece lo suficiente (el más cercano: ${mejor.producto.nombre}).` : "No se encontró ningún producto parecido.");
    } else {
      if (mejor.parecido < PARECIDO_SEGURO) dudas.push(`Parecido ${Math.round(mejor.parecido * 100)}%: confirma que es el producto correcto.`);
      const segundo = candidatos[1];
      if (segundo && segundo.parecido >= mejor.parecido - 0.06 && segundo.parecido >= PARECIDO_MINIMO && !mismoProductoOtraEmpresa(mejor, segundo, tamanoDistinto, indice)) {
        dudas.push(`También podría ser ${segundo.producto.nombre}.`);
      }
      if (tamanoDistinto.has(elegido.codigo)) dudas.push("El tamaño o formato no coincide con el del cliente.");
    }
  }

  if (fila.cantidad == null || !(fila.cantidad > 0)) {
    dudas.push(fila.cantidadOriginal ? `Cantidad «${fila.cantidadOriginal}» no es un número.` : "Falta la cantidad.");
  }

  if (!manual && fila.codigo?.trim() && !mejor?.porCodigo) {
    dudas.push(`El código «${fila.codigo.trim()}» no existe en Relbase: se buscó por el nombre.`);
  }

  // Codigo indicado en el listado o producto creado (fuera de las tres
  // empresas): va tal cual, la opcion de precio no aplica.
  const codigoIndicado = mejor?.porCodigo && elegido?.codigo === mejor.producto.codigo;
  const talCual = codigoIndicado || elegido?.empresa == null;
  const resuelta: LineaResuelta | null =
    opcion && elegido
      ? talCual
        ? {
            productId: elegido.productId,
            codigo: elegido.codigo,
            nombre: elegido.nombre,
            descripcion: null,
            precio: elegido.precio,
            esGenerico: false,
            motivo: codigoIndicado ? "código indicado en el listado" : "producto creado, fuera del catálogo oficial",
          }
        : manual && !porMemoria
          ? resolverLinea(elegido, opcion, indice.porCodigo)
          : resolverConCercanos(elegido, opcion, candidatos, tamanoDistinto, indice)
      : null;
  if (resuelta && fila.precio != null) {
    resuelta.precio = Math.round(fila.precio);
    resuelta.motivo = `${resuelta.motivo} · precio del listado`;
  }
  if (resuelta?.esGenerico) dudas.push(`${resuelta.motivo}, con el precio de ${elegido!.codigo}.`);
  if (resuelta && resuelta.precio == null && fila.precio == null) dudas.push("El producto no tiene precio de referencia: escríbelo en la guía.");
  if (opcion && !elegido && !genericoIndicado) dudas.push("Irá como PRODUCTO GENÉRICO: falta el precio.");

  const estado: EstadoCruce = genericoIndicado ? (dudas.length > 0 ? "revisar" : "ok") : !elegido ? "sin-calce" : dudas.length > 0 ? "revisar" : "ok";
  const resueltaGenerica: LineaResuelta | null =
    genericoIndicado && opcion
      ? {
          productId: PRODUCTO_GENERICO.productId,
          codigo: PRODUCTO_GENERICO.codigo,
          nombre: fila.texto,
          descripcion: fila.texto,
          precio: fila.precio != null ? Math.round(fila.precio) : null,
          esGenerico: true,
          motivo: "genérico, como indica el listado",
        }
      : null;
  return { fila, candidatos: genericoIndicado ? [] : candidatos, elegido, resuelta: resueltaGenerica ?? resuelta, estado, dudas };
}
