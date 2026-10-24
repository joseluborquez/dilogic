-- Traspaso de costos: facturas de un proveedor externo (hoy Supermercado Edon
-- para el centro PALVITAD de Yadran) que se pasan a guias de despacho con el
-- producto generico. Una factura se traspasa una sola vez: la restriccion
-- unica es la que impide emitir dos veces el mismo costo ante el SII.
create table if not exists traspasos_factura (
  id uuid primary key default gen_random_uuid(),
  proveedor_rut text not null,
  folio text not null,
  fecha_factura date,
  neto integer not null,
  total integer not null,
  empresa_id uuid not null references empresas (id),
  centro text not null,
  corrida_id uuid references corridas (id),
  created_at timestamptz not null default now(),
  unique (proveedor_rut, folio)
);

create index if not exists idx_traspasos_factura_corrida on traspasos_factura (corrida_id);

alter table traspasos_factura enable row level security;

-- Las 10 facturas traspasadas a mano el 24-oct-2026 (guias 40973 y 40975,
-- corrida "Facturas proveedor PALVITAD (10)"): sin esto la pantalla las
-- ofreceria de nuevo.
insert into traspasos_factura (proveedor_rut, folio, fecha_factura, neto, total, empresa_id, centro, corrida_id)
select '8528429-0', f.folio, f.fecha::date, f.neto, f.total,
       (select id from empresas where codigo_interno = 'YDR'), 'PALVITAD',
       'a7b31a47-09fb-4918-8b27-f2d08cb6ee67'
  from (values
    ('49118', '2026-10-14', 270319, 321680), ('49123', '2026-10-14', 103874, 123610),
    ('49124', '2026-10-14', 82521, 98200),   ('49125', '2026-10-14', 223559, 270140),
    ('49126', '2026-10-14', 262249, 315030), ('49285', '2026-10-21', 95471, 113610),
    ('49286', '2026-10-21', 197964, 238174), ('49287', '2026-10-21', 263399, 317346),
    ('49288', '2026-10-21', 124477, 151254), ('49303', '2026-10-22', 18067, 21500)
  ) as f (folio, fecha, neto, total)
 where exists (select 1 from corridas where id = 'a7b31a47-09fb-4918-8b27-f2d08cb6ee67')
on conflict (proveedor_rut, folio) do nothing;
