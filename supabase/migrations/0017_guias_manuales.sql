-- Guias de despacho armadas a mano desde la pantalla "Guia manual" (paso 4):
-- cualquier cliente de Relbase, productos de cualquier empresa y el PRODUCTO
-- GENERICO. Las corridas por Excel siguen en corridas / guias_generadas.
--
-- La fila se crea ANTES de llamar a Relbase con la llave de idempotencia de
-- esa emision: un segundo envio del mismo formulario choca con la llave unica
-- y no emite otra guia ante el SII.
create table if not exists guias_manuales (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  estado text not null default 'emitiendo' check (estado in ('emitiendo', 'emitida', 'error')),
  customer_id bigint not null,
  cliente_rut text,
  cliente_nombre text,
  opcion_precio text not null,
  monto_neto numeric not null,
  -- Lo enviado a Relbase, tal cual: para revisar despues que se emitio.
  payload jsonb not null,
  dte_id bigint,
  folio text,
  mensaje_error text,
  usuario_id uuid references auth.users (id),
  usuario text,
  created_at timestamptz not null default now(),
  emitida_en timestamptz
);

create index if not exists idx_guias_manuales_created on guias_manuales (created_at desc);

alter table guias_manuales enable row level security;
