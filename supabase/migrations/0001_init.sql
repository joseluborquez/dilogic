-- Dilogic - Automatizacion de Guias de Despacho
-- Modelo de datos inicial (PRD seccion 7), ajustar segun lo que la API de Relbase
-- realmente devuelva durante el desarrollo.

create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo_interno text not null unique, -- CERQ, MTX, YDR, ... (sin depender de codigo)
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists credenciales_relbase (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  -- Cifrar en la capa de aplicacion antes de insertar (o usar Supabase Vault).
  -- Nunca leer/escribir estos campos desde el cliente.
  token_empresa text not null,
  token_usuario_integrador text not null,
  version_api text not null default 'v1' check (version_api in ('v1', 'v2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id)
);

create table if not exists productos_catalogo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  sku text not null,
  -- ID interno numerico de Relbase; null hasta la primera sincronizacion via
  -- GET /api/v1/productos.
  product_id_relbase bigint,
  descripcion text,
  familia text,
  activo boolean not null default true,
  ultima_sincronizacion timestamptz,
  created_at timestamptz not null default now(),
  unique (empresa_id, sku)
);

create table if not exists corridas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  usuario text not null,
  archivo_original_nombre text not null,
  fecha_ejecucion timestamptz not null default now(),
  total_filas integer not null default 0,
  total_exitosas integer not null default 0,
  total_error integer not null default 0,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'validando', 'generando', 'completada', 'completada_con_errores', 'error')),
  created_at timestamptz not null default now()
);

create table if not exists guias_generadas (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null references corridas(id) on delete cascade,
  sku text not null,
  product_id_relbase bigint,
  cantidad numeric not null check (cantidad > 0),
  categoria text,
  folio_relbase text,
  -- 'generada' se marca inmediatamente al recibir folio, antes de seguir con
  -- la siguiente fila (PRD 6.4: evita duplicar guias ante reintentos).
  estado text not null default 'pendiente' check (estado in ('pendiente', 'generada', 'error')),
  mensaje_error text,
  fecha_generacion timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_productos_catalogo_empresa on productos_catalogo(empresa_id);
create index if not exists idx_corridas_empresa on corridas(empresa_id);
create index if not exists idx_guias_generadas_corrida on guias_generadas(corrida_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_credenciales_relbase_updated_at on credenciales_relbase;
create trigger trg_credenciales_relbase_updated_at
  before update on credenciales_relbase
  for each row execute function set_updated_at();

-- RLS habilitado sin policies publicas: esta app es de uso interno y todas las
-- consultas se hacen server-side con la service_role key (que ignora RLS).
-- No exponer estas tablas a clientes anon/authenticated.
alter table empresas enable row level security;
alter table credenciales_relbase enable row level security;
alter table productos_catalogo enable row level security;
alter table corridas enable row level security;
alter table guias_generadas enable row level security;
