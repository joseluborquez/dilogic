import { cerrarSesionAction } from "@/app/login/actions";

/**
 * Quien esta operando y como salir. Importa que se vea: la app emite
 * documentos tributarios y la guia queda registrada a nombre de esta cuenta.
 */
export function BarraUsuario({
  nombre,
  email,
  rol,
}: {
  nombre: string | null;
  email: string;
  rol: "admin" | "operador";
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-ink-muted">
        {nombre ?? email}
        {rol === "admin" && (
          <span className="ml-2 rounded-sm border border-line px-1.5 py-0.5 text-[11px] tracking-wider uppercase">
            Admin
          </span>
        )}
      </span>
      <form action={cerrarSesionAction}>
        <button
          type="submit"
          className="rounded-sm border border-line px-3 py-1.5 font-display text-sm font-medium transition-colors hover:border-error hover:text-error"
        >
          Salir
        </button>
      </form>
    </div>
  );
}
