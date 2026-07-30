-- Indices para el buscador del historial (folio o centro, parcial). Sin esto
-- un `ilike '%texto%'` obliga a recorrer la tabla entera, que es justo lo que
-- se quiere evitar cuando crezca. pg_trgm permite que un LIKE con comodin a
-- ambos lados use indice.
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_guias_folio_trgm
  on guias_generadas using gin (folio_relbase extensions.gin_trgm_ops);

create index if not exists idx_guias_centro_trgm
  on guias_generadas using gin (centro extensions.gin_trgm_ops);

-- El historial ordena y pagina las solicitudes por fecha.
create index if not exists idx_corridas_fecha on corridas (fecha_ejecucion desc);
