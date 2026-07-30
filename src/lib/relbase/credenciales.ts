import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto/tokens";
import type { RelbaseCredenciales } from "./types";

/**
 * Todas las empresas comparten las credenciales de Relbase de Dilogic
 * (confirmado 09-jul-2026): los tokens son de la cuenta de Dilogic, no del
 * cliente. Para lecturas de referencia (clientes, bodegas, ciudades) basta con
 * cualquiera de las guardadas.
 */
export async function obtenerCredencialesCompartidas(): Promise<RelbaseCredenciales> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("credenciales_relbase")
    .select("token_empresa, token_usuario_integrador")
    .limit(1)
    .maybeSingle();

  if (!data) {
    throw new Error("No hay credenciales de Relbase configuradas.");
  }

  return {
    tokenEmpresa: decryptToken(data.token_empresa),
    tokenUsuarioIntegrador: decryptToken(data.token_usuario_integrador),
  };
}
