"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { obtenerCredencialesCompartidas } from "@/lib/relbase/credenciales";
import { buscarClientesRelbase, RelbaseApiError } from "@/lib/relbase/client";
import { aOpcion, type OpcionReferencia } from "@/lib/empresas/referencias";
import { obtenerCredencialesCifradasExistentes } from "@/lib/empresas/consultar";
import { importarCatalogoDesdeExcel } from "@/lib/catalogo/importar";

export type EstadoEmpresa =
  | { status: "inicial" }
  | { status: "error"; mensaje: string }
  | { status: "ok"; mensaje: string; advertencias: string[] };

/** Solo lectura hacia Relbase: busca el cliente que sera el destinatario. */
export async function buscarClienteRelbaseAction(
  query: string
): Promise<{ ok: true; clientes: OpcionReferencia[] } | { ok: false; mensaje: string }> {
  const texto = query.trim();
  if (texto.length < 3) {
    return { ok: false, mensaje: "Escribe al menos 3 caracteres (RUT o nombre)." };
  }

  try {
    const credenciales = await obtenerCredencialesCompartidas();
    const clientes = await buscarClientesRelbase(credenciales, texto);
    if (clientes.length === 0) {
      return { ok: false, mensaje: "Relbase no encontró clientes con ese RUT o nombre." };
    }
    return { ok: true, clientes: clientes.map(aOpcion) };
  } catch (err) {
    return {
      ok: false,
      mensaje:
        err instanceof RelbaseApiError
          ? `Relbase respondió ${err.status}.`
          : err instanceof Error
            ? err.message
            : "No se pudo consultar Relbase.",
    };
  }
}

function numeroOpcional(valor: FormDataEntryValue | null): number | null {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

function textoOpcional(valor: FormDataEntryValue | null): string | null {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

export async function crearEmpresaAction(
  _prevState: EstadoEmpresa,
  formData: FormData
): Promise<EstadoEmpresa> {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const codigo = String(formData.get("codigo") ?? "")
    .trim()
    .toUpperCase();

  if (!nombre) return { status: "error", mensaje: "Indica el nombre de la empresa." };
  if (!/^[A-Z0-9]{2,10}$/.test(codigo)) {
    return {
      status: "error",
      mensaje: "El código interno debe tener entre 2 y 10 letras o números, sin espacios.",
    };
  }

  const supabase = getSupabaseServiceClient();

  const { data: existente } = await supabase
    .from("empresas")
    .select("id")
    .eq("codigo_interno", codigo)
    .maybeSingle();
  if (existente) {
    return { status: "error", mensaje: `Ya existe una empresa con el código ${codigo}.` };
  }

  const { data: empresa, error } = await supabase
    .from("empresas")
    .insert({
      nombre,
      codigo_interno: codigo,
      activo: true,
      relbase_customer_id: numeroOpcional(formData.get("customerId")),
      dispatch_address: textoOpcional(formData.get("direccion")),
      dispatch_city_id: numeroOpcional(formData.get("cityId")),
      dispatch_commune_id: numeroOpcional(formData.get("communeId")),
      relbase_ware_house_id: numeroOpcional(formData.get("wareHouseId")),
    })
    .select("id")
    .single();

  if (error || !empresa) {
    return { status: "error", mensaje: "No se pudo crear la empresa." };
  }

  const advertencias: string[] = [];

  // Las credenciales son las de Dilogic y las comparten todas las empresas: se
  // copia el par ya cifrado (misma clave), sin descifrarlo ni pedirlo de nuevo.
  const credenciales = await obtenerCredencialesCifradasExistentes();
  if (credenciales) {
    await supabase.from("credenciales_relbase").insert({
      empresa_id: empresa.id,
      token_empresa: credenciales.token_empresa,
      token_usuario_integrador: credenciales.token_usuario_integrador,
      version_api: credenciales.version_api,
    });
  } else {
    advertencias.push(
      "No había credenciales de Relbase que copiar: hay que cargarlas antes de generar guías."
    );
  }

  const archivo = formData.get("catalogo");
  if (archivo instanceof File && archivo.size > 0) {
    try {
      const resultado = await importarCatalogoDesdeExcel(
        empresa.id,
        Buffer.from(await archivo.arrayBuffer())
      );
      advertencias.push(
        `Se cargaron ${resultado.insertados} códigos. Falta sincronizar el catálogo con Relbase para obtener los precios e IDs de producto.`,
        ...resultado.advertencias
      );
    } catch (err) {
      // La empresa ya quedo creada: se informa el problema del catalogo sin
      // deshacerla, porque el catalogo se puede cargar despues.
      advertencias.push(
        `La empresa se creó, pero el catálogo no: ${
          err instanceof Error ? err.message : "error al leer el archivo"
        }`
      );
    }
  } else {
    advertencias.push(
      "La empresa quedó sin catálogo: no va a validar pedidos hasta que le cargues los códigos."
    );
  }

  revalidatePath("/empresas");
  revalidatePath("/nueva-corrida");

  return { status: "ok", mensaje: `${nombre} (${codigo}) quedó creada.`, advertencias };
}

export async function actualizarEmpresaAction(
  _prevState: EstadoEmpresa,
  formData: FormData
): Promise<EstadoEmpresa> {
  const id = String(formData.get("id") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!id) return { status: "error", mensaje: "Empresa no encontrada." };
  if (!nombre) return { status: "error", mensaje: "Indica el nombre de la empresa." };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("empresas")
    .update({
      nombre,
      relbase_customer_id: numeroOpcional(formData.get("customerId")),
      dispatch_address: textoOpcional(formData.get("direccion")),
      dispatch_city_id: numeroOpcional(formData.get("cityId")),
      dispatch_commune_id: numeroOpcional(formData.get("communeId")),
      relbase_ware_house_id: numeroOpcional(formData.get("wareHouseId")),
    })
    .eq("id", id);

  if (error) return { status: "error", mensaje: "No se pudieron guardar los cambios." };

  revalidatePath("/empresas");
  revalidatePath("/nueva-corrida");
  return { status: "ok", mensaje: "Cambios guardados.", advertencias: [] };
}

/**
 * Activar / desactivar. Desactivar solo la saca del selector de pedidos: no
 * borra su historial ni sus guias, que son documentos ya emitidos.
 */
export async function alternarActivoEmpresaAction(
  id: string,
  activo: boolean
): Promise<{ ok: boolean; mensaje?: string }> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("empresas").update({ activo }).eq("id", id);
  if (error) return { ok: false, mensaje: "No se pudo cambiar el estado de la empresa." };

  revalidatePath("/empresas");
  revalidatePath("/nueva-corrida");
  return { ok: true };
}
