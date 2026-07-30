import { requerirAdmin } from "@/lib/auth/sesion";
import { contarGuiasSinUsuario, obtenerResumenUsuarios } from "@/lib/auth/usuarios";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";
import { BotonVolver } from "@/components/ui/BotonVolver";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const admin = await requerirAdmin();
  const [usuarios, guiasSinUsuario] = await Promise.all([
    obtenerResumenUsuarios(),
    contarGuiasSinUsuario(),
  ]);

  const totalGuias = usuarios.reduce((suma, u) => suma + u.guias, 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic · Administración</p>
          <h1 className="font-display text-2xl font-semibold">Usuarios</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Quién puede entrar y cuánto ha generado cada uno. Una cuenta nueva no puede emitir
            guías hasta que la actives.
          </p>
        </div>
        <BotonVolver href="/nueva-corrida">Nueva corrida</BotonVolver>
      </header>

      <dl className="flex flex-wrap gap-6 rounded-sm border border-line bg-surface px-4 py-3 font-mono text-sm">
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
    </main>
  );
}
