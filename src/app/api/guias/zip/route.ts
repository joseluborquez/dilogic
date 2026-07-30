import { z } from "zod";
import { clavesDeCorrida, construirZipGuias, ErrorZip } from "@/lib/historial/zip-guias";

// Descarga masiva: junta los PDF de una seleccion de guias (o de una solicitud
// completa) en un solo ZIP. Solo lee: nada de esto toca Relbase.
//
// Es POST y no GET porque la seleccion es una lista arbitraria de claves, que
// no cabe comoda en una URL. El cliente convierte la respuesta en un blob y
// dispara la descarga (ver components/historial/descargar-zip.ts).
export const maxDuration = 60;

const Cuerpo = z
  .object({
    claves: z.array(z.string()).max(500).optional(),
    corridaId: z.uuid().optional(),
  })
  .refine((c) => c.claves?.length || c.corridaId, {
    message: "Indica las guías a descargar.",
  });

export async function POST(request: Request) {
  let cuerpo: z.infer<typeof Cuerpo>;
  try {
    cuerpo = Cuerpo.parse(await request.json());
  } catch {
    return Response.json({ mensaje: "Solicitud inválida." }, { status: 400 });
  }

  try {
    const claves = cuerpo.claves?.length
      ? cuerpo.claves
      : await clavesDeCorrida(cuerpo.corridaId!);

    const { bytes, nombreArchivo, incluidas, faltantes } = await construirZipGuias(claves);

    return new Response(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), {
      headers: {
        "Content-Type": "application/zip",
        // filename* (RFC 5987) porque los nombres de centro llevan tildes.
        "Content-Disposition": `attachment; filename="guias.zip"; filename*=UTF-8''${encodeURIComponent(
          nombreArchivo
        )}`,
        "Cache-Control": "no-store",
        // Los lee el cliente para avisar cuantas guias quedaron sin PDF.
        "X-Guias-Incluidas": String(incluidas),
        "X-Guias-Faltantes": String(faltantes),
      },
    });
  } catch (err) {
    if (err instanceof ErrorZip) {
      return Response.json({ mensaje: err.message }, { status: 400 });
    }
    console.error("Error armando el ZIP de guias", err);
    return Response.json(
      { mensaje: "No se pudo armar la descarga. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
