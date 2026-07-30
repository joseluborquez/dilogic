-- Eliminacion (logica) de guias del historial de la app. Una guia de despacho
-- es un DTE ya emitido ante el SII: no se puede borrar de Relbase, y borrar la
-- fila aqui destruiria la trazabilidad de lo que se emitio. Por eso "eliminar"
-- solo la marca como archivada; el PDF en storage se conserva para que la
-- accion sea reversible.
alter table guias_generadas
  add column if not exists eliminado_en timestamptz,
  add column if not exists eliminado_por text;

-- El historial pasa a agruparse por corrida (solicitud), y la eliminacion
-- filtra por corrida + folio.
create index if not exists idx_guias_generadas_corrida on guias_generadas (corrida_id);
create index if not exists idx_guias_generadas_corrida_folio
  on guias_generadas (corrida_id, folio_relbase);
