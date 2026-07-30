import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { VersionApi } from "@/lib/supabase/types";

export interface EmpresaOpcion {
  codigo: string;
  nombre: string;
}

export interface EmpresaDetalle extends EmpresaOpcion {
  id: string;
  activo: boolean;
  relbaseCustomerId: number | null;
  dispatchAddress: string | null;
  dispatchCityId: number | null;
  dispatchCommuneId: number | null;
  relbaseWareHouseId: number | null;
  tieneCredenciales: boolean;
  totalSkus: number;
  skusSinProductId: number;
}

/** Empresas que se ofrecen al subir un pedido. */
export async function listarEmpresasActivas(): Promise<EmpresaOpcion[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("empresas")
    .select("codigo_interno, nombre")
    .eq("activo", true)
    .order("nombre");

  return (data ?? []).map((e) => ({ codigo: e.codigo_interno, nombre: e.nombre }));
}

/** Estado completo de cada empresa, para la pantalla de administracion. */
export async function listarEmpresas(): Promise<EmpresaDetalle[]> {
  const supabase = getSupabaseServiceClient();

  const { data: empresas } = await supabase
    .from("empresas")
    .select(
      "id, nombre, codigo_interno, activo, relbase_customer_id, dispatch_address, dispatch_city_id, dispatch_commune_id, relbase_ware_house_id"
    )
    .order("nombre");

  const { data: credenciales } = await supabase
    .from("credenciales_relbase")
    .select("empresa_id");

  const conCredenciales = new Set((credenciales ?? []).map((c) => c.empresa_id));

  return Promise.all(
    (empresas ?? []).map(async (e) => {
      // Conteos con head: no traen filas, solo el total.
      const [{ count: total }, { count: sinId }] = await Promise.all([
        supabase
          .from("productos_catalogo")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", e.id),
        supabase
          .from("productos_catalogo")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", e.id)
          .is("product_id_relbase", null),
      ]);

      return {
        id: e.id,
        codigo: e.codigo_interno,
        nombre: e.nombre,
        activo: e.activo,
        relbaseCustomerId: e.relbase_customer_id,
        dispatchAddress: e.dispatch_address,
        dispatchCityId: e.dispatch_city_id,
        dispatchCommuneId: e.dispatch_commune_id,
        relbaseWareHouseId: e.relbase_ware_house_id,
        tieneCredenciales: conCredenciales.has(e.id),
        totalSkus: total ?? 0,
        skusSinProductId: sinId ?? 0,
      };
    })
  );
}

/**
 * Valores que comparten las empresas ya configuradas, para proponerlos al
 * crear una nueva: la bodega de despacho es la de Dilogic y es la misma para
 * todos los clientes (confirmado: las 3 empresas usan ware_house_id 2793).
 */
export async function obtenerValoresPorDefecto(): Promise<{
  wareHouseId: number | null;
  cityId: number | null;
  communeId: number | null;
}> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("empresas")
    .select("relbase_ware_house_id, dispatch_city_id, dispatch_commune_id")
    .eq("activo", true)
    .not("relbase_ware_house_id", "is", null)
    .limit(1)
    .maybeSingle();

  return {
    wareHouseId: data?.relbase_ware_house_id ?? null,
    cityId: data?.dispatch_city_id ?? null,
    communeId: data?.dispatch_commune_id ?? null,
  };
}

/**
 * Credenciales de Relbase de cualquier empresa ya configurada, tal como estan
 * guardadas (cifradas). Todas las empresas comparten las credenciales de
 * Dilogic, asi que una empresa nueva copia el mismo par: se copia el texto
 * cifrado sin descifrarlo, porque la clave es la misma.
 */
export async function obtenerCredencialesCifradasExistentes(): Promise<{
  token_empresa: string;
  token_usuario_integrador: string;
  version_api: VersionApi;
} | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador, version_api")
    .limit(1)
    .maybeSingle();

  return data ?? null;
}
