-- Memoria de la guia manual: lo que escribio un cliente en su listado y el
-- producto con que salio en una guia emitida. La proxima vez que aparezca el
-- mismo texto se propone ese producto ("Aprendido"). Se llena solo al emitir,
-- es decir, con elecciones ya revisadas por una persona.
create table if not exists memoria_listados (
  -- Texto del cliente normalizado (minusculas, sin tildes ni signos).
  texto text primary key,
  texto_original text not null,
  -- Codigo en Relbase del producto elegido; O-PG-166053 = producto generico.
  codigo text not null,
  product_id bigint,
  veces integer not null default 1,
  usuario text,
  actualizado_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table memoria_listados enable row level security;
