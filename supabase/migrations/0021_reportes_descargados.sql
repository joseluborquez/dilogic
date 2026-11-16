-- Reportes por empresa descargados desde /reportes: el ultimo de cada empresa
-- queda marcado en el calendario, para saber desde donde parte el siguiente
-- (Hugo, 16-11-2026).
create table if not exists reportes_descargados (
  id uuid primary key default gen_random_uuid(),
  empresa text not null,
  desde date not null,
  hasta date not null,
  guias integer not null,
  monto_neto numeric not null,
  usuario_id uuid references auth.users (id),
  usuario text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reportes_descargados_empresa on reportes_descargados (empresa, created_at desc);

alter table reportes_descargados enable row level security;
