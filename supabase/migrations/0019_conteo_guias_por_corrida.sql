-- Conteo de guias por corrida para la pagina de Usuarios. Antes la app bajaba
-- todas las filas de guias_generadas (una por SKU, 31 mil al 28-oct-2026) solo
-- para contar folios distintos: ~3 s por visita y creciendo con cada guia.
-- Solo lectura; mismas reglas que la app: guias no eliminadas, folios
-- distintos de filas generadas, y si la corrida tuvo alguna fila con error.
create or replace function public.conteo_guias_por_corrida()
returns table (
  corrida_id uuid,
  usuario_id uuid,
  fecha_ejecucion timestamptz,
  guias integer,
  con_error boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.usuario_id,
    c.fecha_ejecucion,
    count(distinct g.folio_relbase) filter (where g.estado = 'generada' and g.folio_relbase is not null)::integer,
    coalesce(bool_or(g.estado = 'error'), false)
  from public.corridas c
  left join public.guias_generadas g
    on g.corrida_id = c.id
   and g.eliminado_en is null
  group by c.id, c.usuario_id, c.fecha_ejecucion;
$$;

revoke execute on function public.conteo_guias_por_corrida() from public, anon, authenticated;
grant execute on function public.conteo_guias_por_corrida() to service_role;
