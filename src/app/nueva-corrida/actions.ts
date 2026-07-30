"use server";

import { parseArchivoPedido } from "@/lib/excel/parse";
import { obtenerCatalogoEmpresa, validarFilas, type FilaValidada } from "@/lib/catalogo/validar";
import type { ErrorParseo } from "@/lib/excel/types";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";

export interface ResumenValidacion {
  total: number;
  validos: number;
  advertencias: number;
  errores: number;
}

export type EstadoPrevisualizacion =
  | { status: "inicial" }
  | { status: "error"; mensaje: string }
  | {
      status: "ok";
      empresaCodigo: string;
      empresaNombre: string;
      nombreArchivo: string;
      /**
       * Identifica ESTA validacion. Viaja al generar para que reenviar el
       * formulario no emita un segundo juego de DTEs. Nace aca y no en el
       * componente porque validar otro archivo debe dar una llave nueva, y
       * React reutiliza la instancia del formulario entre validaciones.
       */
      idempotencyKey: string;
      fuenteCatalogo: "supabase" | "local";
      filas: FilaValidada[];
      erroresArchivo: ErrorParseo[];
      resumen: ResumenValidacion;
    };

export async function previsualizarPedidoAction(
  _prevState: EstadoPrevisualizacion,
  formData: FormData
): Promise<EstadoPrevisualizacion> {
  const empresaCodigo = String(formData.get("empresa") ?? "");
  const archivo = formData.get("archivo");

  const empresa = (await listarEmpresasActivas()).find((e) => e.codigo === empresaCodigo);
  if (!empresa) {
    return { status: "error", mensaje: "Selecciona una empresa valida." };
  }

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { status: "error", mensaje: "Adjunta un archivo Excel o CSV con el pedido." };
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const { filas, errores: erroresArchivo } = await parseArchivoPedido(buffer, archivo.name);

  if (filas.length === 0) {
    return {
      status: "error",
      mensaje:
        erroresArchivo[0]?.mensaje ??
        "No se encontraron filas validas para procesar en el archivo.",
    };
  }

  const { mapa: catalogo, fuente } = await obtenerCatalogoEmpresa(empresa.codigo);
  const filasValidadas = validarFilas(filas, catalogo);

  const resumen = filasValidadas.reduce<ResumenValidacion>(
    (acc, fila) => {
      acc.total += 1;
      if (fila.estado === "valido") acc.validos += 1;
      if (fila.estado === "advertencia") acc.advertencias += 1;
      if (fila.estado === "error") acc.errores += 1;
      return acc;
    },
    { total: 0, validos: 0, advertencias: 0, errores: 0 }
  );

  return {
    status: "ok",
    empresaCodigo: empresa.codigo,
    empresaNombre: empresa.nombre,
    nombreArchivo: archivo.name,
    idempotencyKey: crypto.randomUUID(),
    fuenteCatalogo: fuente,
    filas: filasValidadas,
    erroresArchivo,
    resumen,
  };
}
