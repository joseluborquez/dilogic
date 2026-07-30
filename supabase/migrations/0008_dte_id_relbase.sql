-- Id interno del DTE en Relbase, ademas del folio. `GET /dtes/{id}` (la unica
-- via para recuperar el PDF de una guia ya emitida) pide este id, no el folio:
-- sin guardarlo, una guia que no alcanzo a capturar su PDF al generarse no se
-- puede reparar despues. Null en las guias anteriores al 30-jul-2026 y en las
-- filas en error (nunca se creo el documento).
alter table guias_generadas
  add column if not exists dte_id_relbase bigint;
