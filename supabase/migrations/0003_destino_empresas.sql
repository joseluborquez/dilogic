-- Datos de destino de la guia, confirmados con evidencia real (3 guias de
-- ejemplo + lookup en GET /clientes de Relbase, 09-jul-2026): son fijos por
-- empresa cliente, no varian por corrida. Lo unico que varia por corrida es
-- el "contacto" (centro de cultivo especifico), que se ingresa al generar.
alter table empresas
  add column if not exists relbase_customer_id bigint,
  add column if not exists dispatch_address text,
  add column if not exists dispatch_city_id integer,
  add column if not exists dispatch_commune_id integer,
  add column if not exists relbase_ware_house_id bigint;
