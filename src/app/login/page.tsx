import { FormularioAcceso } from "@/components/login/FormularioAcceso";

export const dynamic = "force-dynamic";

const AVISOS: Record<string, string> = {
  pendiente: "Tu cuenta todavía no está aprobada por el administrador.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const volver = typeof params.volver === "string" ? params.volver : "/nueva-corrida";
  const estado = typeof params.estado === "string" ? params.estado : "";

  return (
    <main className="mx-auto flex w-full flex-1 items-center justify-center px-6 py-16">
      <FormularioAcceso volver={volver} aviso={AVISOS[estado] ?? null} />
    </main>
  );
}
