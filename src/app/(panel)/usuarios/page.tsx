import { requerirAdmin } from "@/lib/auth/sesion";
import { obtenerResumenUsuarios } from "@/lib/auth/usuarios";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  // Juntas: la sesion no espera a los conteos ni al reves. Si no es admin,
  // requerirAdmin redirige y los conteos no se muestran.
  const [admin, { usuarios, guiasSinUsuario }] = await Promise.all([requerirAdmin(), obtenerResumenUsuarios()]);

  const totalGuias = usuarios.reduce((suma, u) => suma + u.guias, 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Administración</p>
          <h1 className="font-display text-2xl font-semibold">Usuarios</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Quién puede entrar y cuánto ha generado cada uno. Una cuenta nueva no puede emitir
            guías hasta que la actives.
          </p>
        </div>
      </header>

      <dl className="flex flex-wrap gap-6 vidrio px-4 py-3 font-mono text-sm">
        <div>
          <dt className="text-xs text-ink-muted">cuentas</dt>
          <dd className="font-semibold">{usuarios.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">guías emitidas</dt>
          <dd className="font-semibold">{totalGuias}</dd>
        </div>
        {guiasSinUsuario > 0 && (
          <div>
            <dt className="text-xs text-ink-muted">sin usuario</dt>
            <dd className="font-semibold text-ink-muted">{guiasSinUsuario}</dd>
          </div>
        )}
      </dl>

      {guiasSinUsuario > 0 && (
        <p className="text-xs text-ink-muted">
          Las {guiasSinUsuario} guías «sin usuario» son anteriores a la autenticación: se
          generaron cuando la app no pedía cuenta.
        </p>
      )}

      <ListaUsuarios usuarios={usuarios} yoId={admin.id} />
    </div>
  );
}
