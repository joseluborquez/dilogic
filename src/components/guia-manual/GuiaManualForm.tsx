"use client";

import { useMemo, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import {
  buscarClientesAction,
  buscarOtrosProductosAction,
  cargarClienteAction,
  emitirGuiaManualAction,
  productosPorCodigoAction,
  type ClienteCompleto,
  type ClienteEncontrado,
  type ResultadoEmision,
} from "@/app/(panel)/guia-manual/actions";
import { leerListadoAction, type ListadoLeido } from "@/app/(panel)/guia-manual/actions-listado";
import {
  NOMBRE_EMPRESA,
  OPCIONES_PRECIO,
  PRODUCTO_GENERICO,
  resolverLinea,
  type LineaResuelta,
  type OpcionPrecio,
  type ProductoGuia,
} from "@/lib/guia-manual/resolver";
import { agruparMismoProducto, buscarCandidatos, claveMemoria, cruzarFila, indexarCatalogo, type Cruce, type EstadoCruce, type FilaListado, type IndiceCatalogo } from "@/lib/listado-cliente/cruce";
import { leerFilas, sugerirColumnas, type Columnas } from "@/lib/listado-cliente/columnas";
import { excelRevision } from "@/lib/listado-cliente/excel-revision";
import { crearXlsx, ESTILO } from "@/lib/excel/escribir";
import { equivalentesGuardados, sugerirProductos, detalleSugerencia } from "@/lib/guia-manual/sugerencias";
import { BuscadorProducto } from "./BuscadorProducto";
import { TIPOS_DESPACHO } from "@/lib/relbase/types";

/** Relbase acepta hasta 60 productos por guia: un pedido mas largo se reparte en varias guias. */
const POR_GUIA = 60;
/** Tope de lineas de un pedido (un listado grande son ~10 guias). */
const MAX_LINEAS = 600;

/** Reparte las lineas en guias parejas (160 -> 54 + 53 + 53), sin cambiar el orden. */
function repartir<T>(xs: T[]): T[][] {
  const n = Math.max(1, Math.ceil(xs.length / POR_GUIA));
  const base = Math.floor(xs.length / n);
  const resto = xs.length % n;
  const partes: T[][] = [];
  let i = 0;
  for (let k = 0; k < n; k += 1) {
    const largo = base + (k < resto ? 1 : 0);
    partes.push(xs.slice(i, i + largo));
    i += largo;
  }
  return partes;
}

type Emitida = Extract<ResultadoEmision, { status: "ok" }>;
const CAMPO = "rounded-lg border border-line bg-paper px-3 py-2 text-sm";
const BOTON = "rounded-lg bg-teal px-5 py-2 font-display text-sm font-medium text-on-accent transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50";
const BOTON_SECUNDARIO = "rounded-lg border border-teal px-3 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal hover:text-on-accent disabled:opacity-50";
const ETIQUETA = "text-xs tracking-wide text-ink-muted uppercase";
const GENERICO = "__generico__";

const pesos = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(n));

const ESTADOS: Record<EstadoCruce, { etiqueta: string; clase: string }> = {
  ok: { etiqueta: "OK", clase: "bg-valido-bg text-valido" },
  revisar: { etiqueta: "Revisar", clase: "bg-advertencia-bg text-advertencia" },
  "sin-calce": { etiqueta: "No encontrado", clase: "bg-error-bg text-error" },
};

function letra(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Una linea tal como la arma el usuario, antes de aplicar la opcion de precio.
 * "listado": vino del Excel del cliente; el producto lo propone el cruce y el
 * usuario puede cambiarlo (eleccion: codigo, GENERICO o undefined = el sugerido).
 */
type Linea =
  | { uid: string; tipo: "producto"; producto: ProductoGuia; cantidad: string; precio?: string; descripcion?: string }
  | { uid: string; tipo: "generico"; cantidad: string; precio: string; descripcion: string }
  | {
      uid: string;
      tipo: "listado";
      fila: FilaListado;
      busqueda: ReturnType<typeof buscarCandidatos>;
      eleccion?: string;
      /** El producto salio de la memoria: con este texto ya se emitio antes (veces). */
      memoria?: { codigo: string; veces: number };
      cantidad: string;
      precio?: string;
      descripcion?: string;
    };

interface DatoTransporte {
  valor: string;
  noDisponible: boolean;
}

function Paso({ n, titulo, children, ayuda }: { n: number; titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="vidrio flex flex-col gap-4 p-5">
      <header>
        <h2 className="font-display text-lg font-semibold">
          <span className="mr-2 font-mono text-teal">{n}</span>
          {titulo}
        </h2>
        {ayuda && <p className="mt-1 text-sm text-ink-muted">{ayuda}</p>}
      </header>
      {children}
    </section>
  );
}

export function GuiaManualForm({
  productos,
  creados,
  memoria,
  tipos,
  formas,
}: {
  productos: ProductoGuia[];
  /** Productos creados en Relbase fuera del catalogo oficial (ya usados en guias). */
  creados: ProductoGuia[];
  /** Lo aprendido de guias anteriores: texto del cliente (normalizado) -> codigo. */
  memoria: { texto: string; codigo: string; veces: number }[];
  tipos: { id: number; nombre: string }[];
  formas: { id: number; nombre: string }[];
}) {
  // Productos de Relbase fuera del catalogo que trajo el listado por codigo.
  const [extras, setExtras] = useState<ProductoGuia[]>([]);
  const todos = useMemo(() => [...productos, ...creados, ...extras], [productos, creados, extras]);
  const porCodigo = useMemo(() => new Map(todos.map((p) => [p.codigo, p])), [todos]);
  const indice = useMemo(() => indexarCatalogo(todos), [todos]);
  const recuerdos = useMemo(() => new Map(memoria.map((m) => [m.texto, m])), [memoria]);
  // Mismo producto y formato entre empresas, para sugerir siempre el mas caro (~0,3 s, una vez).
  const grupos = useMemo(() => agruparMismoProducto(indexarCatalogo(productos), equivalentesGuardados), [productos]);
  const sugerir = (texto: string) => sugerirProductos(texto, todos, porCodigo, grupos);
  const [llave, setLlave] = useState(() => crypto.randomUUID());
  const [pendiente, iniciar] = useTransition();

  // 1. Cliente, despacho y pago
  const [textoCliente, setTextoCliente] = useState("");
  const [clientes, setClientes] = useState<ClienteEncontrado[] | null>(null);
  const [cliente, setCliente] = useState<ClienteCompleto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [direccionId, setDireccionId] = useState<number | null>(null);
  const [formaPagoId, setFormaPagoId] = useState<number | null>(null);
  // 2. Precio
  // "Precio mas alto" de entrada: es lo que se usa con clientes externos.
  const [opcion, setOpcion] = useState<OpcionPrecio | null>("alto");
  // 3. Productos
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [textoProducto, setTextoProducto] = useState("");
  const [otros, setOtros] = useState<ProductoGuia[] | null>(null);
  // 3. Listado del cliente
  const inputListado = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [leido, setLeido] = useState<Extract<ListadoLeido, { status: "ok" }> | null>(null);
  const [columnas, setColumnas] = useState<Columnas | null>(null);
  const [verColumnas, setVerColumnas] = useState(false);
  const [avisoListado, setAvisoListado] = useState<string | null>(null);
  // 4. Revision
  const [filtro, setFiltro] = useState<EstadoCruce | "todas">("todas");
  // 5. Datos de la guia
  const [tipoTraslado, setTipoTraslado] = useState(6);
  const [tipoDespacho, setTipoDespacho] = useState<number | null>(null);
  const [contacto, setContacto] = useState("");
  const [comentario, setComentario] = useState("");
  const [transporte, setTransporte] = useState<Record<"patente" | "rutTransportista" | "rutChofer" | "nombreChofer", DatoTransporte>>({
    patente: { valor: "", noDisponible: false },
    rutTransportista: { valor: "", noDisponible: false },
    rutChofer: { valor: "", noDisponible: false },
    nombreChofer: { valor: "", noDisponible: false },
  });
  // Emision
  const [confirmando, setConfirmando] = useState(false);
  const [entiendo, setEntiendo] = useState(false);
  /** Guias ya emitidas de este pedido; sus lineas salen del formulario. */
  const [emitidas, setEmitidas] = useState<Emitida[]>([]);
  const [errorEmision, setErrorEmision] = useState<string | null>(null);
  const [terminado, setTerminado] = useState(false);

  function buscarCliente() {
    setAviso(null);
    iniciar(async () => setClientes(await buscarClientesAction(textoCliente)));
  }

  function elegirCliente(id: number) {
    setAviso(null);
    iniciar(async () => {
      const r = await cargarClienteAction(id);
      if (!r.ok) return setAviso(r.mensaje);
      setCliente(r.cliente);
      setClientes(null);
      setDireccionId(null);
      setFormaPagoId(r.cliente.formaPagoId);
    });
  }

  const sugeridos = useMemo(
    () => sugerirProductos(textoProducto, todos, porCodigo, grupos, 15),
    [textoProducto, todos, porCodigo, grupos]
  );

  const agregar = (p: ProductoGuia) =>
    setLineas((ls) => (ls.length >= MAX_LINEAS ? ls : [...ls, { uid: crypto.randomUUID(), tipo: "producto", producto: p, cantidad: "1" }]));
  const agregarGenerico = () =>
    setLineas((ls) =>
      ls.length >= MAX_LINEAS ? ls : [...ls, { uid: crypto.randomUUID(), tipo: "generico", cantidad: "1", precio: "", descripcion: "" }]
    );
  const cambiar = (uid: string, cambios: Partial<{ cantidad: string; precio: string; descripcion: string; eleccion: string }>) =>
    setLineas((ls) => ls.map((l) => (l.uid === uid ? ({ ...l, ...cambios } as Linea) : l)));
  const quitar = (uid: string) => setLineas((ls) => ls.filter((l) => l.uid !== uid));
  /** Cambia el producto de una linea: la del listado guarda la eleccion; un generico agregado a mano pasa a ser ese producto. */
  const elegirProducto = (uid: string, p: ProductoGuia) =>
    setLineas((ls) =>
      ls.map((l) =>
        l.uid !== uid
          ? l
          : l.tipo === "listado"
            ? { ...l, eleccion: p.codigo, precio: undefined, descripcion: undefined }
            : { uid: l.uid, tipo: "producto", producto: p, cantidad: l.cantidad }
      )
    );
  // Linea cuya descripcion de generico se esta escribiendo: debajo se sugieren productos.
  const [sugerirPara, setSugerirPara] = useState<string | null>(null);

  // --- Listado del cliente ---------------------------------------------------

  /** Reemplaza las lineas que vinieron de un listado anterior; las agregadas a mano se quedan. */
  function cargarListado(filas: FilaListado[], indiceUsado: IndiceCatalogo): Linea[] {
    const aMano = lineas.filter((l) => l.tipo !== "listado");
    const cupo = Math.max(0, MAX_LINEAS - aMano.length);
    setAvisoListado(
      filas.length === 0
        ? "No se encontraron productos con cantidad. Revisa las columnas."
        : filas.length > cupo
          ? `El listado trae ${filas.length} productos: se cargaron los primeros ${cupo}.`
          : null
    );
    const nuevas: Linea[] = filas.slice(0, cupo).map((f) => {
      // Lo aprendido manda salvo que el listado traiga su propio codigo.
      const r = f.codigo?.trim() ? undefined : recuerdos.get(claveMemoria(f.texto));
      const recordado = r && (r.codigo === PRODUCTO_GENERICO.codigo || indiceUsado.porCodigo.has(r.codigo.toUpperCase())) ? r : undefined;
      return {
        uid: crypto.randomUUID(),
        tipo: "listado",
        fila: f,
        busqueda: buscarCandidatos(f, indiceUsado),
        eleccion: recordado ? (recordado.codigo === PRODUCTO_GENERICO.codigo ? GENERICO : recordado.codigo) : undefined,
        memoria: recordado ? { codigo: recordado.codigo, veces: recordado.veces } : undefined,
        cantidad: f.cantidad != null && f.cantidad > 0 ? String(f.cantidad) : "",
        precio: f.precio != null ? String(Math.round(f.precio)) : undefined,
      };
    });
    setLineas([...aMano, ...nuevas]);
    setFiltro("todas");
    return nuevas;
  }

  /**
   * Lee las lineas con las columnas elegidas; los codigos que no estan en el
   * catalogo se buscan en Relbase antes del cruce (productos creados para un
   * cliente esporadico).
   */
  async function prepararListado(filasExcel: Extract<ListadoLeido, { status: "ok" }>["filas"], col: Columnas) {
    const filas = leerFilas(filasExcel, col);
    // Codigos fuera del catalogo: los que trae el listado y los aprendidos para sus textos.
    const aprendidos = filas.map((f) => recuerdos.get(claveMemoria(f.texto))?.codigo).filter((c) => c && c !== PRODUCTO_GENERICO.codigo);
    const faltan = [...new Set([...filas.map((f) => f.codigo?.trim().toUpperCase()), ...aprendidos].filter((c): c is string => Boolean(c) && !porCodigo.has(c!)))];
    let nuevos: ProductoGuia[] = [];
    if (faltan.length > 0) nuevos = (await productosPorCodigoAction(faltan)).filter((p) => !porCodigo.has(p.codigo));
    const conNuevos = [...todos, ...nuevos];
    if (nuevos.length > 0) setExtras((e) => [...e, ...nuevos]);
    const indiceUsado = nuevos.length > 0 ? indexarCatalogo(conNuevos) : indice;
    cargarListado(filas, indiceUsado);
  }


  function leerArchivo(file: File, hoja?: number) {
    setAvisoListado(null);
    const fd = new FormData();
    fd.set("archivo", file);
    if (hoja != null) fd.set("hoja", String(hoja));
    iniciar(async () => {
      const r = await leerListadoAction(fd);
      if (r.status === "error") {
        setLeido(null);
        return setAvisoListado(r.mensaje);
      }
      const col = sugerirColumnas(r.filas);
      setLeido(r);
      setColumnas(col);
      await prepararListado(r.filas, col);
    });
  }

  function elegirArchivo(file: File | undefined) {
    if (!file) return;
    setArchivo(file);
    leerArchivo(file);
  }

  function cambiarColumnas(col: Columnas) {
    setColumnas(col);
    if (leido) iniciar(() => prepararListado(leido.filas, col));
  }

  function descargarPlantilla() {
    const t = (v: string | number | null, s?: number) => ({ v, s });
    const bytes = crearXlsx({
      nombre: "Listado",
      anchos: [40, 12, 16, 14],
      filasFijas: 1,
      filas: [
        [t("Producto", ESTILO.encabezado), t("Cantidad", ESTILO.encabezado), t("Código", ESTILO.encabezado), t("Precio", ESTILO.encabezado)],
        [t("Huevos"), t(180), t(null), t(null)],
        [t("Posta rosada"), t(12.5), t(null), t(null)],
        [t("Producto creado para el cliente"), t(4), t("A-AD-124343"), t(null)],
        [t("Producto con precio acordado"), t(2), t(null), t(15990, ESTILO.pesos)],
      ],
    });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-listado-cliente.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastrando(false);
    elegirArchivo(e.dataTransfer.files?.[0]);
  }

  // --- Resolucion de cada linea ---------------------------------------------

  /** La linea con la opcion de precio aplicada y lo que el usuario edito encima. */
  const resueltas = lineas.map((l) => {
    if (l.tipo === "generico") {
      const r: LineaResuelta = {
        productId: PRODUCTO_GENERICO.productId,
        codigo: PRODUCTO_GENERICO.codigo,
        nombre: l.descripcion,
        descripcion: l.descripcion,
        precio: l.precio === "" ? null : Number(l.precio),
        esGenerico: true,
        motivo: "genérico con descripción propia",
      };
      return { linea: l, r, precio: l.precio, descripcion: l.descripcion, cruce: null as Cruce | null };
    }
    if (l.tipo === "listado") {
      const manual = l.eleccion === undefined ? undefined : l.eleccion === GENERICO ? null : (porCodigo.get(l.eleccion) ?? null);
      const fila = { ...l.fila, cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : null };
      const cruce = cruzarFila(fila, indice, opcion, manual, l.busqueda, l.memoria != null && (l.eleccion === l.memoria.codigo || (l.eleccion === GENERICO && l.memoria.codigo === PRODUCTO_GENERICO.codigo)));
      const r: LineaResuelta | null = cruce.elegido || cruce.resuelta
        ? cruce.resuelta
        : opcion
          ? {
              productId: PRODUCTO_GENERICO.productId,
              codigo: PRODUCTO_GENERICO.codigo,
              nombre: l.fila.texto,
              descripcion: l.fila.texto,
              precio: null,
              esGenerico: true,
              motivo: "no está en el catálogo: va como genérico",
            }
          : null;
      const precio = l.precio ?? (r?.precio != null ? String(r.precio) : "");
      const descripcion = l.descripcion ?? r?.descripcion ?? "";
      return { linea: l, r, precio, descripcion, cruce };
    }
    const r = opcion ? resolverLinea(l.producto, opcion, porCodigo) : null;
    const precio = l.precio ?? (r?.precio != null ? String(r.precio) : "");
    const descripcion = l.descripcion ?? r?.descripcion ?? "";
    return { linea: l, r, precio, descripcion, cruce: null as Cruce | null };
  });

  const neto = resueltas.reduce((s, x) => s + (Number(x.precio) || 0) * (Number(x.linea.cantidad) || 0), 0);
  const delListado = resueltas.filter((x) => x.cruce);
  const cuenta = (e: EstadoCruce) => delListado.filter((x) => x.cruce!.estado === e).length;
  const visibles = filtro === "todas" ? resueltas : resueltas.filter((x) => x.cruce?.estado === filtro);

  const problemas: string[] = [];
  if (!cliente) problemas.push("Elige el cliente.");
  if (!opcion) problemas.push("Elige la opción de precio.");
  if (lineas.length === 0) problemas.push("Agrega productos o sube el listado del cliente.");
  resueltas.forEach((x, i) => {
    const c = Number(x.linea.cantidad);
    const p = Number(x.precio);
    if (!(c > 0)) problemas.push(`Línea ${i + 1}: cantidad inválida.`);
    if (!Number.isInteger(p) || p <= 0) problemas.push(`Línea ${i + 1}: falta el precio (en pesos, sin decimales).`);
    if (x.r?.esGenerico && !x.descripcion.trim()) problemas.push(`Línea ${i + 1}: el genérico necesita descripción.`);
  });
  if (!tipoDespacho) problemas.push("Elige el tipo de despacho.");
  for (const [k, nombre] of [
    ["patente", "la patente"],
    ["rutTransportista", "el RUT del transportista"],
    ["rutChofer", "el RUT del chofer"],
    ["nombreChofer", "el nombre del chofer"],
  ] as const) {
    if (!transporte[k].noDisponible && !transporte[k].valor.trim()) problemas.push(`Escribe ${nombre} o marca «no se cuenta con este dato».`);
  }

  function descargarRevision() {
    if (!opcion || !archivo) return;
    const cruces = delListado.map((x) => x.cruce!);
    const bytes = excelRevision(cruces, opcion, archivo.name);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `revision-${archivo.name.replace(/\.[^.]+$/, "")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const guias = repartir(resueltas);

  /**
   * Emite el pedido en una o mas guias, una tras otra. Cada guia lleva su
   * llave (llave del pedido + numero + primera linea): reintentar sin cambiar
   * nada devuelve la misma guia en vez de emitir otra. Cada guia emitida saca
   * sus lineas del formulario, asi un reintento solo emite lo que falta.
   */
  function emitir() {
    if (!cliente || !opcion || !tipoDespacho) return;
    const dato = (k: keyof typeof transporte) => (transporte[k].noDisponible ? null : transporte[k].valor.trim());
    setErrorEmision(null);
    iniciar(async () => {
      for (const [k, grupo] of guias.entries()) {
        let r: ResultadoEmision;
        try {
          r = await emitirGuiaManualAction({
            idempotencyKey: `${llave}-${k + 1}-${grupo[0].linea.uid}`,
            clienteId: cliente.id,
            direccionDespachoId: direccionId,
            formaPagoId,
            opcion,
            tipoTraslado,
            tipoDespacho,
            contacto,
            comentario,
            transporte: {
              patente: dato("patente"),
              rutTransportista: dato("rutTransportista"),
              rutChofer: dato("rutChofer"),
              nombreChofer: dato("nombreChofer"),
            },
            aprender: grupo.flatMap((x) =>
              // Solo lo que escribio el cliente: en un listado de puros codigos el "texto" es el codigo y no se aprende.
              x.linea.tipo === "listado" && x.cruce && x.linea.fila.texto.trim().toUpperCase() !== (x.linea.fila.codigo ?? "").trim().toUpperCase()
                ? [
                    x.r!.esGenerico || !x.cruce.elegido
                      ? { texto: x.linea.fila.texto, codigo: PRODUCTO_GENERICO.codigo, productId: PRODUCTO_GENERICO.productId }
                      : { texto: x.linea.fila.texto, codigo: x.cruce.elegido.codigo, productId: x.cruce.elegido.productId },
                  ]
                : []
            ),
            lineas: grupo.map((x) => ({
              productId: x.r!.productId,
              codigo: x.r!.codigo,
              descripcion: x.r!.esGenerico ? x.descripcion.trim() : null,
              cantidad: Number(x.linea.cantidad),
              precio: Number(x.precio),
            })),
          });
        } catch {
          r = { status: "error", mensaje: "Se perdió la conexión. Vuelve a emitir: si la guía alcanzó a salir, no se repite.", nuevaLlave: false };
        }
        if (r.status === "error") {
          setErrorEmision(guias.length > 1 ? `Guía ${k + 1} de ${guias.length}: ${r.mensaje}` : r.mensaje);
          // Rechazada por Relbase (no se emitio): la correccion sale con otra llave.
          if (r.nuevaLlave) setLlave(crypto.randomUUID());
          break;
        }
        const emitida = r;
        const uids = new Set(grupo.map((x) => x.linea.uid));
        setEmitidas((e) => [...e, emitida]);
        setLineas((ls) => ls.filter((l) => !uids.has(l.uid)));
        if (k === guias.length - 1) setTerminado(true);
      }
      setConfirmando(false);
      setEntiendo(false);
    });
  }

  function nuevaGuia() {
    setLlave(crypto.randomUUID());
    setEmitidas([]);
    setTerminado(false);
    setErrorEmision(null);
    setLineas([]);
    setArchivo(null);
    setLeido(null);
    setContacto("");
    setComentario("");
  }

  const listaEmitidas = emitidas.length > 0 && (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-paper text-sm">
      {emitidas.map((g) => (
        <li key={g.dteId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <span>
            Folio <span className="font-mono font-medium">{g.folio}</span>
            {g.yaEmitida && <span className="text-ink-muted"> (ya estaba emitida)</span>}
          </span>
          <span className="flex items-center gap-4">
            <span className="font-mono">{pesos(g.neto)}</span>
            {g.pdfUrl && (
              <a href={g.pdfUrl} target="_blank" rel="noreferrer" className="text-teal hover:underline">
                PDF
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );

  if (terminado) {
    return (
      <section className="vidrio flex flex-col gap-4 p-6">
        <h2 className="font-display text-xl font-semibold text-valido">
          {emitidas.length === 1 ? `Guía emitida: folio ${emitidas[0].folio}` : `${emitidas.length} guías emitidas`}
        </h2>
        <p className="text-sm text-ink-muted">
          Neto total {pesos(emitidas.reduce((s, g) => s + g.neto, 0))}. Ya están en Relbase y se enviaron al SII.
        </p>
        {listaEmitidas}
        <button type="button" onClick={nuevaGuia} className={`${BOTON_SECUNDARIO} self-start`}>
          Hacer otra guía
        </button>
      </section>
    );
  }

  const lugares = cliente ? [cliente.principal, ...cliente.despacho] : [];
  const lugar = lugares.find((l) => l.id === direccionId) ?? cliente?.principal;
  const cabecera = leido && columnas ? (leido.filas[columnas.encabezado] ?? []) : [];
  const anchoHoja = leido ? Math.max(0, ...leido.filas.map((f) => f.length)) : 0;
  const nombreColumna = (i: number | null) => (i == null ? "—" : `${letra(i)}${cabecera[i] != null ? ` (${String(cabecera[i]).slice(0, 20)})` : ""}`);

  return (
    <div className="flex flex-col gap-6">
      <Paso n={1} titulo="Productos" ayuda={`Sube el listado del cliente (producto y cantidad) o agrégalos uno a uno. Si pasan de ${POR_GUIA}, se reparten en varias guías.`}>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Códigos y precios:</span>
          <select value={opcion ?? "alto"} onChange={(e) => setOpcion(e.target.value as OpcionPrecio)} className={CAMPO}>
            {OPCIONES_PRECIO.map((o) => (
              <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
            ))}
          </select>
          <span className="text-xs text-ink-muted">{OPCIONES_PRECIO.find((o) => o.valor === opcion)?.ayuda}</span>
        </label>
        <label
          htmlFor="listado"
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
            arrastrando ? "border-teal bg-teal/5" : "border-line bg-paper"
          }`}
        >
          <input ref={inputListado} id="listado" type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => elegirArchivo(e.target.files?.[0])} />
          {archivo ? (
            <span className="font-mono text-sm">{pendiente && !leido ? `Leyendo ${archivo.name}…` : archivo.name}</span>
          ) : (
            <span className="font-display text-sm font-medium">Arrastra acá el listado del cliente (Excel o CSV)</span>
          )}
          <span className="text-xs text-ink-muted">
            {archivo ? "Haz clic para cambiarlo" : "Se asigna código y precio a cada línea según la opción de precio"}
          </span>
        </label>
        {!archivo && (
          <details className="rounded-lg border border-line bg-paper px-4 py-3 text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">¿Cómo armar el archivo?</summary>
            <ul className="mt-3 flex flex-col gap-1.5 text-ink-muted">
              <li>Basta con dos columnas: <span className="text-ink">Producto</span> y <span className="text-ink">Cantidad</span>.</li>
              <li>Cada producto se busca en el catálogo de Cermaq, Multiexport y Yadran y toma el código según «Códigos y precios» (de entrada, el de precio más alto).</li>
              <li>Si no está ahí, se usa un producto creado parecido (de los que ya usaste en otras guías); si no hay, va como producto genérico con el nombre del cliente.</li>
              <li>Opcional: <span className="text-ink">Código</span> o <span className="text-ink">Precio</span>, si ya los sabes; mandan sobre lo anterior. Las hojas ocultas no se leen.</li>
            </ul>
            <button type="button" onClick={descargarPlantilla} className="mt-3 text-teal hover:underline">
              Descargar plantilla
            </button>
          </details>
        )}

        {leido && columnas && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-ink-muted">
              {leido.hojas.length > 1 && <>Hoja «{leido.hojas[leido.hoja]}» · </>}
              Producto en columna {nombreColumna(columnas.descripcion)} · cantidad en {nombreColumna(columnas.cantidad)}
              {columnas.codigo != null && <> · código en {nombreColumna(columnas.codigo)}</>}
              {columnas.precio != null && <> · precio en {nombreColumna(columnas.precio)}</>}.{" "}
              <button type="button" onClick={() => setVerColumnas((v) => !v)} className="text-teal hover:underline">
                {verColumnas ? "Listo" : "Cambiar"}
              </button>
            </p>
            {verColumnas && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {leido.hojas.length > 1 && (
                  <label className="flex flex-col gap-1">
                    <span className={ETIQUETA}>Hoja</span>
                    <select value={leido.hoja} onChange={(e) => archivo && leerArchivo(archivo, Number(e.target.value))} className={CAMPO}>
                      {leido.hojas.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className={ETIQUETA}>Fila de títulos</span>
                  <select value={columnas.encabezado} onChange={(e) => cambiarColumnas({ ...columnas, encabezado: Number(e.target.value) })} className={CAMPO}>
                    {leido.filas.slice(0, 25).map((f, i) => (
                      <option key={i} value={i}>
                        Fila {i + 1}: {f.filter((c) => c != null).slice(0, 3).join(" · ").slice(0, 40) || "(vacía)"}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ["descripcion", "Producto"],
                    ["cantidad", "Cantidad"],
                    ["codigo", "Código (opcional)"],
                    ["precio", "Precio (opcional)"],
                  ] as const
                ).map(([campo, nombre]) => (
                  <label key={campo} className="flex flex-col gap-1">
                    <span className={ETIQUETA}>{nombre}</span>
                    <select
                      value={columnas[campo] ?? ""}
                      onChange={(e) => cambiarColumnas({ ...columnas, [campo]: e.target.value === "" ? null : Number(e.target.value) })}
                      className={CAMPO}
                    >
                      <option value="">— No tiene —</option>
                      {Array.from({ length: anchoHoja }, (_, i) => (
                        <option key={i} value={i}>{nombreColumna(i)}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {(avisoListado || (leido?.avisos.length ?? 0) > 0) && (
          <div className="flex flex-col gap-1 rounded-lg bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
            {leido?.avisos.map((a) => <p key={a}>{a}</p>)}
            {avisoListado && <p>{avisoListado}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <input value={textoProducto} onChange={(e) => { setTextoProducto(e.target.value); setOtros(null); }} placeholder="Agregar a mano: posta rosada, MTX_AB_002…" className={`${CAMPO} min-w-0 flex-1`} />
          <button type="button" onClick={agregarGenerico} className={BOTON_SECUNDARIO}>
            + Producto genérico
          </button>
        </div>
        {textoProducto.trim() && (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-paper">
              {sugeridos.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Ningún producto del catálogo coincide.</li>}
              {[...sugeridos, ...(otros ?? []).map((p) => ({ producto: p, otros: [] }))].map(({ producto: p, ...s }) => (
                <li key={p.codigo}>
                  <button type="button" onClick={() => agregar(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted">
                    <span>
                      {p.nombre} <span className="font-mono text-xs text-ink-muted">{p.codigo}</span>
                      <span className="ml-2 text-xs text-ink-muted">{p.empresa ? NOMBRE_EMPRESA[p.empresa] : "producto creado"}</span>
                      {s.otros.length > 0 && <span className="block text-xs text-ink-muted">{detalleSugerencia({ producto: p, otros: s.otros }, pesos)}</span>}
                    </span>
                    <span className="font-mono whitespace-nowrap">{p.precio != null ? pesos(p.precio) : "sin precio"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {otros == null && (
              <button
                type="button"
                disabled={pendiente}
                onClick={() => iniciar(async () => setOtros(await buscarOtrosProductosAction(textoProducto)))}
                className="self-start text-sm text-teal hover:underline"
              >
                Buscar también en otros productos de Relbase
              </button>
            )}
          </div>
        )}
      </Paso>

      <Paso n={2} titulo="Revisión" ayuda={lineas.length > 0 ? "Así saldrá la guía. Escribe los precios que falten y cambia lo que necesites." : undefined}>
        {lineas.length === 0 ? (
          <p className="text-sm text-ink-muted">Todavía no hay productos.</p>
        ) : (
          <>
            {delListado.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {(
                  [
                    ["todas", `Todas (${resueltas.length})`, "border-line"],
                    ["ok", `OK (${cuenta("ok")})`, "border-valido"],
                    ["revisar", `Revisar (${cuenta("revisar")})`, "border-advertencia"],
                    ["sin-calce", `No encontrados (${cuenta("sin-calce")})`, "border-error"],
                  ] as const
                ).map(([valor, texto, borde]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setFiltro(valor)}
                    className={`rounded-full border px-3 py-1 ${borde} ${filtro === valor ? "bg-surface-muted font-medium" : ""}`}
                  >
                    {texto}
                  </button>
                ))}
                <button type="button" onClick={descargarRevision} disabled={!opcion} className="ml-auto text-sm text-teal hover:underline disabled:opacity-50">
                  Descargar Excel para revisar
                </button>
              </div>
            )}
            {/* En pantallas anchas sin scroll propio: si no, la lista de sugerencias quedaria cortada dentro de la tabla. */}
            <div className="overflow-x-auto rounded-lg border border-line lg:overflow-visible">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-left text-xs tracking-wide text-ink-muted uppercase">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Sale como</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Precio neto</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((x) => {
                    const i = resueltas.indexOf(x);
                    const l = x.linea;
                    const c = x.cruce;
                    return (
                      <tr key={l.uid} className="border-b border-line align-top last:border-0">
                        <td className="px-3 py-2 font-mono text-ink-muted">{i + 1}</td>
                        <td className="min-w-72 px-3 py-2">
                          {l.tipo === "listado" && c && (
                            <span className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                              <span className={`rounded-full px-2 py-0.5 font-medium ${ESTADOS[c.estado].clase}`}>{ESTADOS[c.estado].etiqueta}</span>
                              Pidió: «{l.fila.texto}»{l.fila.unidad ? ` · ${l.fila.unidad}` : ""}
                            </span>
                          )}
                          {l.tipo === "listado" && l.memoria && (l.eleccion === l.memoria.codigo || (l.eleccion === GENERICO && l.memoria.codigo === PRODUCTO_GENERICO.codigo)) && (
                            <span className="mb-1 block text-xs text-teal">
                              Aprendido: así salió {l.memoria.veces === 1 ? "la vez anterior" : `las últimas ${l.memoria.veces} veces`}
                            </span>
                          )}
                          {l.tipo === "listado" && c && (
                            <div className="mb-1">
                              <span className={ETIQUETA}>Producto (escribe para buscar)</span>
                              <BuscadorProducto
                                actual={c.elegido}
                                candidatos={c.candidatos.map((k) => k.producto)}
                                sugerir={sugerir}
                                onElegir={(p) => elegirProducto(l.uid, p)}
                                onGenerico={() => cambiar(l.uid, { eleccion: GENERICO })}
                              />
                            </div>
                          )}
                          {x.r?.esGenerico ? (
                            <>
                              <span className={ETIQUETA}>Descripción del genérico</span>
                              <input
                                value={x.descripcion}
                                onChange={(e) => {
                                  cambiar(l.uid, { descripcion: e.target.value });
                                  setSugerirPara(l.uid);
                                }}
                                onBlur={() => setTimeout(() => setSugerirPara((u) => (u === l.uid ? null : u)), 150)}
                                placeholder="Qué producto es"
                                className={`${CAMPO} w-full`}
                              />
                              {sugerirPara === l.uid && x.descripcion.trim().length >= 3 && (() => {
                                const opciones = sugerir(x.descripcion).slice(0, 5);
                                return opciones.length === 0 ? null : (
                                  <div className="mt-1 rounded-lg border border-line bg-paper p-1 text-sm">
                                    <p className="px-2 py-1 text-xs text-ink-muted">¿Es uno de estos? Al elegirlo se carga con su precio.</p>
                                    {opciones.map((o) => (
                                      <button
                                        key={o.producto.codigo}
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                          elegirProducto(l.uid, o.producto);
                                          setSugerirPara(null);
                                        }}
                                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
                                      >
                                        <span className="min-w-0 truncate">
                                          {o.producto.nombre} <span className="font-mono text-xs text-ink-muted">{o.producto.codigo}</span>
                                        </span>
                                        <span className="shrink-0 font-mono">{o.producto.precio != null ? pesos(o.producto.precio) : "sin precio"}</span>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                              <span className="mt-1 block font-mono text-xs text-ink-muted">{PRODUCTO_GENERICO.codigo} · PRODUCTO GENERICO</span>
                            </>
                          ) : x.r ? (
                            l.tipo !== "listado" || x.r.codigo !== c?.elegido?.codigo ? (
                              <>
                                <span className="block">{x.r.nombre}</span>
                                <span className="font-mono text-xs text-ink-muted">{x.r.codigo}</span>
                              </>
                            ) : null
                          ) : (
                            l.tipo === "producto" && <span className="block">{l.producto.nombre}</span>
                          )}
                          {x.r && <span className="block text-xs text-ink-muted">{x.r.motivo}</span>}
                          {c && c.dudas.length > 0 && <span className="block text-xs text-advertencia">{c.dudas.join(" ")}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(l.uid, { cantidad: e.target.value.replace(",", ".") })} className={`${CAMPO} w-24 text-right font-mono`} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input inputMode="numeric" value={x.precio} onChange={(e) => cambiar(l.uid, { precio: e.target.value.replace(/\D/g, "") })} className={`${CAMPO} w-28 text-right font-mono`} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                          {pesos((Number(x.precio) || 0) * (Number(l.cantidad) || 0))}
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => quitar(l.uid)} className="text-xs text-ink-muted hover:text-error" aria-label={`Quitar línea ${i + 1}`}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <dl className="flex flex-wrap justify-end gap-6 font-mono text-sm">
              <div><dt className="text-xs text-ink-muted">Neto</dt><dd>{pesos(neto)}</dd></div>
              <div><dt className="text-xs text-ink-muted">IVA 19%</dt><dd>{pesos(neto * 0.19)}</dd></div>
              <div><dt className="text-xs text-ink-muted">Total</dt><dd className="font-semibold">{pesos(neto * 1.19)}</dd></div>
            </dl>
          </>
        )}
      </Paso>

      <Paso n={3} titulo="Cliente">
        {cliente ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-paper p-4 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className={ETIQUETA}>Razón social</dt><dd>{cliente.nombre}</dd></div>
                <div><dt className={ETIQUETA}>RUT</dt><dd className="font-mono">{cliente.rut}</dd></div>
                <div><dt className={ETIQUETA}>Ciudad</dt><dd>{cliente.principal.ciudad ?? "—"}</dd></div>
                <div><dt className={ETIQUETA}>Comuna</dt><dd>{cliente.principal.comuna ?? "—"}</dd></div>
              </dl>
              <button type="button" onClick={() => setCliente(null)} className="text-sm text-ink-muted hover:underline">
                Cambiar cliente
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={ETIQUETA}>Despachar a</span>
                <select value={direccionId ?? ""} onChange={(e) => setDireccionId(e.target.value ? Number(e.target.value) : null)} className={CAMPO}>
                  {lugares.map((l) => (
                    <option key={l.id ?? "principal"} value={l.id ?? ""}>
                      {l.id == null ? "Dirección principal: " : ""}
                      {l.direccion || "(sin dirección en Relbase)"}
                      {l.comuna ? `, ${l.comuna}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={ETIQUETA}>Forma de pago</span>
                <select value={formaPagoId ?? ""} onChange={(e) => setFormaPagoId(e.target.value ? Number(e.target.value) : null)} className={CAMPO}>
                  <option value="">Sin forma de pago</option>
                  {formas.map((f) => (
                    <option key={f.id} value={f.id}>{f.nombre}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                buscarCliente();
              }}
            >
              <input value={textoCliente} onChange={(e) => setTextoCliente(e.target.value)} placeholder="Nombre o RUT del cliente" className={`${CAMPO} min-w-0 flex-1`} />
              <button type="submit" disabled={pendiente || textoCliente.trim().length < 2} className={BOTON_SECUNDARIO}>
                {pendiente ? "Buscando…" : "Buscar"}
              </button>
            </form>
            {clientes && (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-paper">
                {clientes.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Ningún cliente coincide.</li>}
                {clientes.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => elegirCliente(c.id)} className="w-full px-3 py-2 text-left text-sm hover:bg-surface-muted">
                      <span className="font-medium">{c.nombre}</span> <span className="font-mono text-ink-muted">{c.rut}</span>
                      <span className="block text-xs text-ink-muted">{c.direccion}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {aviso && <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{aviso}</p>}
      </Paso>

      <Paso n={4} titulo="Datos de la guía">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={ETIQUETA}>Tipo de traslado</span>
            <select value={tipoTraslado} onChange={(e) => setTipoTraslado(Number(e.target.value))} className={CAMPO}>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={ETIQUETA}>Tipo de despacho (obligatorio)</span>
            <select value={tipoDespacho ?? ""} onChange={(e) => setTipoDespacho(e.target.value ? Number(e.target.value) : null)} className={CAMPO}>
              <option value="">Elige…</option>
              {Object.entries(TIPOS_DESPACHO).map(([id, nombre]) => (
                <option key={id} value={id}>{id} · {nombre}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={ETIQUETA}>Contacto / centro</span>
            <input value={contacto} onChange={(e) => setContacto(e.target.value)} className={CAMPO} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ETIQUETA}>Comentario</span>
            <input value={comentario} onChange={(e) => setComentario(e.target.value)} className={CAMPO} />
          </label>
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-sm text-ink-muted">Transporte: escribe cada dato o marca que no se cuenta con él.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["patente", "Patente"],
                ["rutTransportista", "RUT transportista"],
                ["rutChofer", "RUT chofer"],
                ["nombreChofer", "Nombre chofer"],
              ] as const
            ).map(([k, nombre]) => (
              <div key={k} className="flex flex-col gap-1">
                <span className={ETIQUETA}>{nombre}</span>
                <input
                  value={transporte[k].valor}
                  disabled={transporte[k].noDisponible}
                  onChange={(e) => setTransporte((t) => ({ ...t, [k]: { ...t[k], valor: e.target.value } }))}
                  className={`${CAMPO} disabled:opacity-40`}
                />
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={transporte[k].noDisponible}
                    onChange={(e) => setTransporte((t) => ({ ...t, [k]: { valor: "", noDisponible: e.target.checked } }))}
                    className="accent-[var(--teal)]"
                  />
                  No se cuenta con este dato
                </label>
              </div>
            ))}
          </div>
        </div>
      </Paso>

      <section className="vidrio flex flex-col gap-3 p-5">
        {emitidas.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-valido">Ya se emitieron {emitidas.length === 1 ? "1 guía" : `${emitidas.length} guías`} de este pedido; abajo quedan solo los productos que faltan.</p>
            {listaEmitidas}
          </div>
        )}
        {errorEmision && <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{errorEmision}</p>}
        {problemas.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-ink-muted">
            {problemas.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
            {problemas.length > 6 && <li>y {problemas.length - 6} más</li>}
          </ul>
        ) : (
          <p className="text-sm">
            Todo listo: {lineas.length} productos, neto {pesos(neto)}
            {guias.length > 1 && <> · se emitirán {guias.length} guías ({guias.map((g) => g.length).join(" + ")} productos)</>}.
          </p>
        )}
        <button type="button" disabled={problemas.length > 0 || pendiente} onClick={() => setConfirmando(true)} className={`${BOTON} self-start`}>
          Revisar y emitir
        </button>
      </section>

      {confirmando && cliente && (
        <div className="animar-aparecer fixed inset-0 z-20 flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="confirmar-titulo">
          <div className="vidrio flex w-full max-w-lg flex-col gap-4 p-6">
            <h2 id="confirmar-titulo" className="font-display text-lg font-semibold">
              {guias.length > 1 ? `¿Emitir estas ${guias.length} guías?` : "¿Emitir esta guía?"}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-muted">Cliente</dt><dd>{cliente.nombre} ({cliente.rut})</dd>
              <dt className="text-ink-muted">Despacho a</dt><dd>{lugar?.direccion}{lugar?.comuna ? `, ${lugar.comuna}` : ""}</dd>
              <dt className="text-ink-muted">Productos</dt>
              <dd>
                {lineas.length}
                {guias.length > 1 && <span className="text-ink-muted"> en {guias.length} guías ({guias.map((g) => g.length).join(" + ")})</span>}
              </dd>
              <dt className="text-ink-muted">Neto</dt><dd className="font-mono">{pesos(neto)}</dd>
              <dt className="text-ink-muted">Total</dt><dd className="font-mono font-semibold">{pesos(neto * 1.19)}</dd>
              <dt className="text-ink-muted">Despacho</dt><dd>{tipoDespacho ? TIPOS_DESPACHO[tipoDespacho as 1 | 2 | 3] : ""}</dd>
            </dl>
            <p className="rounded-lg bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
              {guias.length > 1 ? "Las guías se emiten" : "La guía se emite"} en Relbase y {guias.length > 1 ? "van" : "va"} directo al SII. Si algo está mal, habrá que anularla.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} className="accent-[var(--teal)]" />
              Revisé el resumen y quiero {guias.length > 1 ? "emitirlas" : "emitirla"}
            </label>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setConfirmando(false)} disabled={pendiente} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-muted">
                Volver
              </button>
              <button type="button" onClick={emitir} disabled={!entiendo || pendiente} className={BOTON}>
                {pendiente ? `Emitiendo${guias.length > 1 ? ` (${emitidas.length + 1} de ${emitidas.length + guias.length})` : ""}…` : guias.length > 1 ? `Emitir ${guias.length} guías` : "Emitir guía"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
