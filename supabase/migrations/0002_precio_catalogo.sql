-- Agrega el precio de catalogo, necesario para el payload de creacion de
-- guias en Relbase (POST /api/v1/dtes, campo "price" obligatorio por
-- producto). Nullable: se completa en la sincronizacion con Relbase.
alter table productos_catalogo
  add column if not exists precio numeric;
