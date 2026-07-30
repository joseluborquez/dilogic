-- Llave de idempotencia por corrida. Una guia de despacho es un DTE del SII:
-- reenviar el formulario (recargar, doble click, reintento del navegador)
-- creaba un segundo juego completo de guias, sin forma de deshacerlo salvo
-- anulando una por una en Relbase. El navegador manda la misma llave para el
-- mismo pedido validado; el indice unico hace que el segundo intento choque en
-- vez de generar de nuevo.
alter table corridas
  add column if not exists idempotency_key text;

-- Parcial: las corridas anteriores tienen la columna en null y no deben
-- competir entre si por el indice.
create unique index if not exists idx_corridas_idempotency
  on corridas (idempotency_key)
  where idempotency_key is not null;
