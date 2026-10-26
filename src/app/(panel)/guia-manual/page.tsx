import { unstable_cache } from "next/cache";
import { requerirUsuario } from "@/lib/auth/sesion";
import { listarFormasPago, obtenerTiposTraslado } from "@/lib/relbase/client";
import { productosCreados, productosParaGuia, desdePrecios } from "@/lib/guia-manual/datos";
import { cargarMemoria } from "@/lib/guia-manual/memoria";
import { GuiaManualForm } from "@/components/guia-manual/GuiaManualForm";

export const dynamic = "force-dynamic";
// Emitir espera el PDF de la guia (hasta ~8 s) despues del POST a Relbase.
export const maxDuration = 60;

// Listas fijas de Relbase: pedirlas en cada visita costaba ~0,5 s.
const tiposTraslado = unstable_cache(obtenerTiposTraslado, ["relbase-tipos-traslado-v1"], { revalidate: 86400 });
const formasPago = unstable_cache(listarFormasPago, ["relbase-formas-pago-v1"], { revalidate: 86400 });

export default async function GuiaManualPage() {
  await requerirUsuario();
  const [productos, creados, memoria, tipos, formas] = await Promise.all([productosParaGuia(), productosCreados(), cargarMemoria(), tiposTraslado(), formasPago()]);
  const desde = desdePrecios();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Guía manual</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Para cualquier cliente de Relbase. Precio: el último cobrado desde el{" "}
          {new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(desde))}, o el del
          catálogo.
        </p>
      </header>

      <GuiaManualForm
        productos={productos}
        creados={creados}
        memoria={memoria}
        tipos={tipos.map((t) => ({ id: t.id, nombre: t.name }))}
        formas={formas.map((f) => ({ id: f.id, nombre: f.name }))}
      />
    </div>
  );
}
