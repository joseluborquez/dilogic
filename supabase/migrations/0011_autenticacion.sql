-- Autenticacion y roles. Hasta ahora la app era abierta: cualquiera con la URL
-- podia emitir guias de despacho, que son DTEs ante el SII.
--
-- El registro es autoservicio pero con dos barreras: solo correos @dilogic.cl
-- (se valida al crear la cuenta) y estado 'pendiente' hasta que un
-- administrador lo active. Nadie emite documentos sin que Hugo lo sepa.
create table if not exists perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  nombre text,
  rol text not null default 'operador' check (rol in ('admin', 'operador')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'bloqueado')),
  created_at timestamptz not null default now(),
  activado_en timestamptz
);

-- Quien genero cada corrida. La columna `usuario` (texto libre) queda para las
-- corridas anteriores a la autenticacion, donde siempre decia "Hugo Venegas".
alter table corridas
  add column if not exists usuario_id uuid references auth.users (id);

create index if not exists idx_corridas_usuario on corridas (usuario_id);

-- Toda lectura/escritura pasa por el service_role desde el servidor, que
-- ignora RLS. Se activa igual para que la clave anonima (que si viaja al
-- navegador) no pueda leer la tabla de perfiles.
alter table perfiles enable row level security;
