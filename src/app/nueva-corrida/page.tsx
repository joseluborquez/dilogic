import { NuevaCorridaForm } from "@/components/nueva-corrida/NuevaCorridaForm";
import { listarEmpresasActivas } from "@/lib/empresas/consultar";
import { requerirUsuario } from "@/lib/auth/sesion";
import { BarraUsuario } from "@/components/ui/BarraUsuario";
import { PieHerramientas, type Herramienta } from "@/components/ui/PieHerramientas";

// Lo secundario va al pie, segun el rol: los usuarios hacen guias, ven el
// historial, crean empresas y sincronizan el catalogo; el resto es de admins.
const HERRAMIENTAS_USUARIO: Herramienta[] = [
  { href: "/historial", titulo: "Historial" },
  { href: "/empresas", titulo: "Empresas" },
  { href: "/catalogo", titulo: "Catálogo" },
];
const HERRAMIENTAS_ADMIN: Herramienta[] = [
  ...HERRAMIENTAS_USUARIO,
  { href: "/traspaso", titulo: "Traspaso de costos" },
  { href: "/usuarios", titulo: "Usuarios" },
];

// Las empresas se leen de la base en cada carga: agregar una nueva debe
// reflejarse aca sin volver a desplegar.
export const dynamic = "force-dynamic";

export default async function NuevaCorridaPage() {
  const usuario = await requerirUsuario();
  const empresas = await listarEmpresasActivas();
  const herramientas = usuario.rol === "admin" ? HERRAMIENTAS_ADMIN : HERRAMIENTAS_USUARIO;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <BarraUsuario nombre={usuario.nombre} email={usuario.email} rol={usuario.rol} />

      <header>
        <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
        <h1 className="font-display text-2xl font-semibold">Nueva corrida de guías de despacho</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sube el pedido ya depurado, revisa la validación por fila y genera las guías en Relbase.
        </p>
      </header>

      <NuevaCorridaForm empresas={empresas} />

      <PieHerramientas herramientas={herramientas} />
    </main>
  );
}
