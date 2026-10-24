-- Conexion OAuth2 con la API v2 de Relbase (migracion v1 -> v2).
--
-- v2 reemplaza los tokens fijos (company + authorization) por OAuth2
-- authorization_code: un admin autoriza una vez y la app queda con un
-- access_token (15 min) y un refresh_token que ROTA en cada renovacion (el
-- anterior queda revocado). Una sola fila: las tres empresas usan la cuenta
-- Relbase de Dilogic (ver lib/relbase/credenciales.ts), igual que hoy.
--
-- credenciales_relbase (v1) no se toca: queda para volver atras mientras dure
-- la migracion.
create table if not exists relbase_conexion (
  id boolean primary key default true check (id), -- fuerza fila unica
  -- Ambos tokens cifrados en la capa de aplicacion (AES-256-GCM con
  -- CREDENTIALS_ENCRYPTION_KEY, ver lib/crypto/tokens.ts).
  access_token text not null,
  refresh_token text not null,
  access_token_expira_en timestamptz not null,
  scope text not null,
  estado text not null default 'conectada' check (estado in ('conectada', 'revocada')),
  -- Ultimo fallo al renovar (ej. refresh_token revocado): se muestra al admin
  -- para que reconecte.
  ultimo_error text,
  conectado_por uuid references auth.users (id),
  conectado_en timestamptz not null default now(),
  renovado_en timestamptz,
  -- Candado de renovacion. Si dos invocaciones renuevan a la vez, la segunda
  -- usaria un refresh_token ya rotado y Relbase revocaria la conexion. Solo
  -- renueva quien toma el candado (tomar_renovacion_relbase); el resto espera
  -- y relee el token nuevo.
  renovacion_bloqueada_hasta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_relbase_conexion_updated_at on relbase_conexion;
create trigger trg_relbase_conexion_updated_at
  before update on relbase_conexion
  for each row execute function set_updated_at();

-- Toma el candado de renovacion de forma atomica (un solo UPDATE, con la hora
-- del servidor de base de datos y no la de cada funcion serverless). Devuelve
-- true solo a quien lo obtuvo.
create or replace function public.tomar_renovacion_relbase(p_segundos integer default 30)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with tomado as (
    update public.relbase_conexion
       set renovacion_bloqueada_hasta = now() + make_interval(secs => p_segundos)
     where id
       and estado = 'conectada'
       and (renovacion_bloqueada_hasta is null or renovacion_bloqueada_hasta < now())
    returning 1
  )
  select exists (select 1 from tomado);
$$;

revoke execute on function public.tomar_renovacion_relbase(integer) from public, anon, authenticated;
grant execute on function public.tomar_renovacion_relbase(integer) to service_role;

-- Igual que el resto: solo el service_role (server-side) la lee.
alter table relbase_conexion enable row level security;
