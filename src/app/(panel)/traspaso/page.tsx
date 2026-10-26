import { TraspasoForm } from "@/components/traspaso/TraspasoForm";
import { requerirAdmin } from "@/lib/auth/sesion";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Emitir lee los PDF, consulta Relbase y espera el PDF de cada guia: con
// varias guias pasa del limite por defecto de una funcion.
export const maxDuration = 300;

export default async function TraspasoPage() {
  await requerirAdmin();
  const empresas = await listarEmpresasActivas();

  // Se proponen la empresa y el centro del ultimo traspaso: casi siempre se
  // repiten (hoy, Yadran / PALVITAD).
  const { data: ultimo } = await getSupabaseServiceClient()
    .from("traspasos_factura")
    .select("centro, empresa_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: empresaUltima } = ultimo
    ? await getSupabaseServiceClient().from("empresas").select("codigo_interno").eq("id", ultimo.empresa_id).maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Traspaso de costos</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Para centros abastecidos por otro proveedor: sube sus facturas en PDF y se generan las
            guías con el producto genérico, juntando los productos repetidos, en la menor cantidad
            de guías y con el mismo total que las facturas.
          </p>
        </div>
      </header>

      <TraspasoForm
        empresas={empresas}
        empresaInicial={empresaUltima?.codigo_interno ?? empresas[0]?.codigo ?? ""}
        centroInicial={ultimo?.centro ?? ""}
      />
    </div>
  );
}
