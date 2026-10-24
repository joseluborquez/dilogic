import type { EstadoConexion } from "@/lib/relbase/oauth";

const MENSAJES_ERROR: Record<string, string> = {
  origen:
    "La conexión con Relbase solo se puede hacer desde https://dilogic.vercel.app (Relbase no acepta direcciones locales).",
  configuracion: "Faltan las variables RELBASE_OAUTH_* en el servidor.",
  state: "La autorización expiró o no coincide. Vuelve a intentarlo.",
  canje: "Relbase no aceptó la autorización. Vuelve a intentarlo; si persiste, revisa la aplicación en Relbase.",
  access_denied: "Se canceló la autorización en Relbase.",
};

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

export function ConexionRelbase({
  conexion,
  resultado,
  motivo,
}: {
  conexion: EstadoConexion;
  resultado?: string;
  motivo?: string;
}) {
  const conectada = conexion.estado === "conectada";

  return (
    <section className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-base font-semibold">Conexión con Relbase (API v2)</h2>
          {conectada ? (
            <p className="text-sm text-valido">
              Conectada
              {conexion.conectadoEn && ` el ${formatearFecha(conexion.conectadoEn)}`}
              {conexion.conectadoPor && ` por ${conexion.conectadoPor}`}.
            </p>
          ) : conexion.estado === "revocada" ? (
            <p className="text-sm text-error">
              Relbase cerró la conexión. Hay que volver a conectarla.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Todavía no está conectada.</p>
          )}
        </div>
        {/* <a> y no <Link>: es una ruta de API que redirige a Relbase. */}
        <a
          href="/api/relbase/oauth/iniciar"
          className="rounded-sm bg-teal px-5 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong"
        >
          {conexion.estado === "sin_conectar" ? "Conectar con Relbase" : "Reconectar"}
        </a>
      </div>

      {conectada && conexion.scopesFaltantes.length > 0 && (
        <p className="rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">
          Faltan permisos: {conexion.scopesFaltantes.join(", ")}. Reconecta y acéptalos todos.
        </p>
      )}
      {conexion.ultimoError && (
        <p className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          Último error: {conexion.ultimoError}
        </p>
      )}
      {resultado === "conectado" && (
        <p className="rounded-sm bg-valido-bg px-3 py-2 text-sm text-valido">
          Listo: Relbase quedó conectado.
        </p>
      )}
      {resultado === "error" && (
        <p className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {MENSAJES_ERROR[motivo ?? ""] ?? "No se pudo conectar con Relbase. Vuelve a intentarlo."}
        </p>
      )}
    </section>
  );
}
