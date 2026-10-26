"use server";

import Papa from "papaparse";
import { leerLibro, listaHojas } from "@/lib/excel/libro";
import { requerirUsuario } from "@/lib/auth/sesion";
import type { Celda } from "@/lib/listado-cliente/columnas";

const MAX_FILAS = 600;

export type ListadoLeido =
  | { status: "error"; mensaje: string }
  | {
      status: "ok";
      archivo: string;
      /** Hojas del libro; `hoja` es la que se leyo. */
      hojas: string[];
      hoja: number;
      filas: Celda[][];
      recortado: boolean;
      /** Lo que no se leyo (hojas ocultas), para decirlo en pantalla. */
      avisos: string[];
    };

function aCelda(v: unknown): Celda {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/**
 * Solo lee el archivo: el cruce con el catalogo corre en la pantalla. No
 * llama a Relbase ni escribe en la base. `hoja` = null elige la hoja con mas
 * filas con datos.
 */
export async function leerListadoAction(formData: FormData): Promise<ListadoLeido> {
  await requerirUsuario();
  const archivo = formData.get("archivo");
  const hojaPedida = formData.get("hoja");
  if (!(archivo instanceof File) || archivo.size === 0) return { status: "error", mensaje: "Adjunta el Excel o CSV del cliente." };

  const extension = archivo.name.split(".").pop()?.toLowerCase();
  const buffer = Buffer.from(await archivo.arrayBuffer());
  let libro: { nombre: string; filas: Celda[][] }[];
  const avisos: string[] = [];
  try {
    if (extension === "csv") {
      const { data } = Papa.parse<string[]>(buffer.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: true });
      libro = [{ nombre: "CSV", filas: data.map((f) => f.map(aCelda)) }];
    } else if (extension === "xlsx") {
      const hojas = await leerLibro(buffer);
      const ocultas = hojas.filter((h) => h.oculta).map((h) => h.nombre);
      if (ocultas.length > 0) avisos.push(`No se leyó ${listaHojas(ocultas)}: ${ocultas.length === 1 ? "está oculta" : "están ocultas"} en el Excel.`);
      libro = hojas.filter((h) => !h.oculta).map((h) => ({ nombre: h.nombre, filas: h.data.map((f) => f.map(aCelda)) }));
      if (libro.length === 0) return { status: "error", mensaje: "No se leyó el archivo: todas sus hojas están ocultas." };
    } else {
      return { status: "error", mensaje: "El archivo debe ser .xlsx o .csv. Si es .xls (Excel antiguo), ábrelo y guárdalo como .xlsx." };
    }
  } catch {
    return { status: "error", mensaje: "No se pudo leer el archivo. Revisa que sea un Excel válido." };
  }

  const conDatos = (f: Celda[][]) => f.filter((r) => r.some((c) => c != null)).length;
  let hoja = hojaPedida != null && hojaPedida !== "" ? Number(hojaPedida) : -1;
  if (!(hoja >= 0 && hoja < libro.length)) hoja = libro.reduce((mejor, h, i) => (conDatos(h.filas) > conDatos(libro[mejor].filas) ? i : mejor), 0);
  const filas = libro[hoja]?.filas ?? [];
  if (conDatos(filas) === 0) return { status: "error", mensaje: "La hoja está vacía." };

  return {
    status: "ok",
    archivo: archivo.name,
    hojas: libro.map((h) => h.nombre),
    hoja,
    filas: filas.slice(0, MAX_FILAS),
    recortado: filas.length > MAX_FILAS,
    avisos,
  };
}
