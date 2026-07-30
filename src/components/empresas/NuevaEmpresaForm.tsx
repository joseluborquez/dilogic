"use client";

import { useActionState, useState } from "react";
import { crearEmpresaAction, type EstadoEmpresa } from "@/app/empresas/actions";
import type { OpcionReferencia } from "@/lib/empresas/referencias";
import { BuscadorClienteRelbase } from "./BuscadorClienteRelbase";

const ESTADO_INICIAL: EstadoEmpresa = { status: "inicial" };

interface Props {
  valoresPorDefecto: {
    wareHouseId: number | null;
    cityId: number | null;
    communeId: number | null;
  };
}

export function NuevaEmpresaForm({ valoresPorDefecto }: Props) {
  const [estado, formAction, pending] = useActionState(crearEmpresaAction, ESTADO_INICIAL);
  const [abierto, setAbierto] = useState(false);
  const [cliente, setCliente] = useState<OpcionReferencia | null>(null);
  const [direccion, setDireccion] = useState("");
  const [cityId, setCityId] = useState(String(valoresPorDefecto.cityId ?? ""));
  const [communeId, setCommuneId] = useState(String(valoresPorDefecto.communeId ?? ""));
  const [nombreCatalogo, setNombreCatalogo] = useState<string | null>(null);

  function elegirCliente(elegido: OpcionReferencia) {
    setCliente(elegido);
    // Relbase suele traer la direccion del cliente: se propone como direccion
    // de despacho, pero queda editable porque no siempre viene completa.
    if (elegido.direccion) setDireccion(elegido.direccion);
    if (elegido.ciudadId) setCityId(String(elegido.ciudadId));
    if (elegido.comunaId) setCommuneId(String(elegido.comunaId));
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="self-start rounded-sm bg-teal px-4 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong"
      >
        Agregar empresa
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-sm border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Nueva empresa</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Usa las mismas credenciales de Relbase que las demás. Lo único propio de cada empresa es
            a quién se le despacha y su lista de códigos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="shrink-0 text-sm text-ink-muted hover:underline"
        >
          Cancelar
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-xs tracking-wide text-ink-muted uppercase">
            Nombre
          </label>
          <input
            id="nombre"
            name="nombre"
            required
            placeholder="Ej: Salmones Camanchaca"
            className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="codigo" className="text-xs tracking-wide text-ink-muted uppercase">
            Código interno
          </label>
          <input
            id="codigo"
            name="codigo"
            required
            maxLength={10}
            placeholder="Ej: CAM"
            className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm uppercase"
          />
          <p className="text-xs text-ink-muted">
            Es el prefijo de sus códigos de producto (CAM_AB_001). No se puede cambiar después.
          </p>
        </div>
      </div>

      <BuscadorClienteRelbase onElegir={elegirCliente} elegido={cliente} />
      <input type="hidden" name="customerId" value={cliente?.id ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="direccion" className="text-xs tracking-wide text-ink-muted uppercase">
            Dirección de despacho
          </label>
          <input
            id="direccion"
            name="direccion"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Se completa al elegir el cliente"
            className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cityId" className="text-xs tracking-wide text-ink-muted uppercase">
            ID de ciudad
          </label>
          <input
            id="cityId"
            name="cityId"
            inputMode="numeric"
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="communeId" className="text-xs tracking-wide text-ink-muted uppercase">
            ID de comuna
          </label>
          <input
            id="communeId"
            name="communeId"
            inputMode="numeric"
            value={communeId}
            onChange={(e) => setCommuneId(e.target.value)}
            className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wareHouseId" className="text-xs tracking-wide text-ink-muted uppercase">
            Bodega de salida
          </label>
          <input
            id="wareHouseId"
            name="wareHouseId"
            inputMode="numeric"
            defaultValue={valoresPorDefecto.wareHouseId ?? ""}
            className="rounded-sm border border-line bg-paper px-3 py-2 font-mono text-sm"
          />
          <p className="text-xs text-ink-muted">La bodega de Dilogic, igual para todos.</p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="catalogo" className="text-xs tracking-wide text-ink-muted uppercase">
          Catálogo de códigos (Excel)
        </label>
        <input
          id="catalogo"
          name="catalogo"
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setNombreCatalogo(e.target.files?.[0]?.name ?? null)}
          className="rounded-sm border border-line bg-paper px-3 py-2 text-sm"
        />
        <p className="text-xs text-ink-muted">
          Con columnas <span className="font-mono">codigo</span> y{" "}
          <span className="font-mono">nombre</span>, igual que CODIGOS DILOGIC.xlsx.
          {nombreCatalogo && <> Archivo: {nombreCatalogo}</>}
        </p>
      </div>

      {estado.status === "error" && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-sm text-error">
          {estado.mensaje}
        </p>
      )}

      {estado.status === "ok" && (
        <div className="flex flex-col gap-2 rounded-sm bg-valido-bg px-3 py-2 text-sm text-valido">
          <p className="font-medium">{estado.mensaje}</p>
          {estado.advertencias.map((a, i) => (
            <p key={i} className="text-ink-muted">
              {a}
            </p>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-teal px-5 py-2 font-display text-sm font-medium text-white transition-colors hover:bg-teal-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creando…" : "Crear empresa"}
        </button>
      </div>
    </form>
  );
}
