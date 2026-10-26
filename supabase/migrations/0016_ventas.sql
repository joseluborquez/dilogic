-- Ventas: copia de las guias de despacho (tipo 52) de Relbase con sus
-- productos, para los indicadores de la pagina de inicio. Relbase es la
-- fuente: estas tablas se rellenan solo desde la sincronizacion de ventas y
-- se pueden reconstruir enteras volviendo a cargarlas.
create table if not exists ventas_guias (
  dte_id bigint primary key, -- id del DTE en Relbase
  folio integer not null,
  fecha date not null, -- start_date
  -- Estado ante el SII. "cancel" = anulada: nunca cuenta como venta. Se
  -- relee a diario por los ultimos 3 meses para captar anulaciones tardias.
  sii_status text,
  anulada boolean generated always as (sii_status = 'cancel') stored,
  customer_id bigint,
  contacto text,
  type_transfer integer,
  monto_neto numeric not null default 0,
  monto_total numeric not null default 0,
  -- false hasta traer el detalle (GET /dtes/{id}); el listado no trae productos.
  lineas_cargadas boolean not null default false,
  actualizado_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ventas_guias_fecha on ventas_guias (fecha);
create index if not exists idx_ventas_guias_pendientes on ventas_guias (fecha)
  where not lineas_cargadas;

create table if not exists ventas_lineas (
  dte_id bigint not null references ventas_guias (dte_id) on delete cascade,
  linea integer not null, -- posicion en la guia, desde 1
  product_id bigint,
  codigo text,
  nombre text,
  -- Por el codigo: CERQ / YDR / MTX, GENERICO (O-PG-166053) u OTROS. Familia
  -- AB / CC / FV / AS solo en los codigos EMPRESA_FAMILIA_NUMERO.
  empresa text not null,
  familia text,
  cantidad numeric not null,
  precio numeric not null, -- neto unitario
  descuento numeric, -- tal como viene de Relbase (porcentaje)
  monto_neto numeric not null,
  primary key (dte_id, linea)
);

create index if not exists idx_ventas_lineas_codigo on ventas_lineas (codigo);

create table if not exists sincronizaciones_ventas (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('manual', 'automatica', 'carga_inicial')),
  desde date not null,
  iniciada_en timestamptz not null default now(),
  terminada_en timestamptz,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'parcial', 'error')),
  resumen jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sincronizaciones_ventas_iniciada
  on sincronizaciones_ventas (iniciada_en desc);

alter table ventas_guias enable row level security;
alter table ventas_lineas enable row level security;
alter table sincronizaciones_ventas enable row level security;
