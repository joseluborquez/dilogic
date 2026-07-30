"use client";

import { useActionState, useState } from "react";
import {
  ingresarAction,
  registrarAction,
  type EstadoLogin,
} from "@/app/login/actions";
import { DOMINIO_PERMITIDO } from "@/lib/auth/constantes";

const ESTADO_INICIAL: EstadoLogin = { status: "inicial" };

const CAMPO = "rounded-sm border border-line bg-paper px-3 py-2 text-sm";
const ETIQUETA = "text-xs tracking-wide text-ink-muted uppercase";

export function FormularioAcceso({ volver, aviso }: { volver: string; aviso: string | null }) {
  const [modo, setModo] = useState<"ingresar" | "registrar">("ingresar");
  const [estadoIngreso, accionIngresar, ingresando] = useActionState(
    ingresarAction,
    ESTADO_INICIAL
  );
  const [estadoRegistro, accionRegistrar, registrando] = useActionState(
    registrarAction,
    ESTADO_INICIAL
  );

  const estado = modo === "ingresar" ? estadoIngreso : estadoRegistro;

  return (
    <div className="flex w-full max-w-sm flex-col gap-5 rounded-sm border border-line bg-surface p-6">
      <div>
        <p className="text-xs tracking-widest text-ink-muted uppercase">Dilogic</p>
        <h1 className="font-display text-xl font-semibold">
          {modo === "ingresar" ? "Entrar" : "Crear cuenta"}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {modo === "ingresar"
            ? "Guías de despacho."
            : `Solo correos @${DOMINIO_PERMITIDO}. Un administrador debe aprobar la cuenta antes del primer ingreso.`}
        </p>
      </div>

      {aviso && (
        <p className="rounded-sm bg-advertencia-bg px-3 py-2 text-sm text-advertencia">{aviso}</p>
      )}

      {modo === "ingresar" ? (
        <form action={accionIngresar} className="flex flex-col gap-3">
          <input type="hidden" name="volver" value={volver} />
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className={ETIQUETA}>
              Correo
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className={CAMPO} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className={ETIQUETA}>
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={CAMPO}
            />
          </div>
          <button
            type="submit"
            disabled={ingresando}
            className="mt-1 rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:opacity-50"
          >
            {ingresando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      ) : (
        <form action={accionRegistrar} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="nombre" className={ETIQUETA}>
              Nombre
            </label>
            <input id="nombre" name="nombre" required autoComplete="name" className={CAMPO} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="email-registro" className={ETIQUETA}>
              Correo
            </label>
            <input
              id="email-registro"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={`nombre@${DOMINIO_PERMITIDO}`}
              className={CAMPO}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password-registro" className={ETIQUETA}>
              Contraseña
            </label>
            <input
              id="password-registro"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={CAMPO}
            />
            <p className="text-xs text-ink-muted">Mínimo 8 caracteres.</p>
          </div>
          <button
            type="submit"
            disabled={registrando}
            className="mt-1 rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:opacity-50"
          >
            {registrando ? "Creando…" : "Crear cuenta"}
          </button>
        </form>
      )}

      {estado.status === "error" && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {estado.mensaje}
        </p>
      )}
      {estado.status === "registrado" && (
        <p className="rounded-sm bg-valido-bg px-3 py-2 text-sm text-valido">{estado.mensaje}</p>
      )}

      <button
        type="button"
        onClick={() => setModo(modo === "ingresar" ? "registrar" : "ingresar")}
        className="text-sm text-teal hover:underline"
      >
        {modo === "ingresar" ? "Crear una cuenta nueva" : "Ya tengo cuenta, entrar"}
      </button>
    </div>
  );
}
