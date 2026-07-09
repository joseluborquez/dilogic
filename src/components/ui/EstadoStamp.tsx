import type { EstadoFila } from "@/lib/catalogo/validar";

const CONFIG: Record<EstadoFila, { label: string; className: string }> = {
  valido: {
    label: "VÁLIDO",
    className: "border-valido text-valido bg-valido-bg",
  },
  advertencia: {
    label: "REVISAR",
    className: "border-advertencia text-advertencia bg-advertencia-bg",
  },
  error: {
    label: "ERROR",
    className: "border-error text-error bg-error-bg",
  },
};

export function EstadoStamp({ estado }: { estado: EstadoFila }) {
  const cfg = CONFIG[estado];
  return (
    <span
      className={`inline-block -rotate-2 select-none rounded-sm border-2 px-2 py-0.5 font-display text-[11px] font-semibold tracking-wider whitespace-nowrap ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
