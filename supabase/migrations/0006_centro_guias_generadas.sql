-- Soporte para pedidos formato matriz (una columna por centro de cultivo):
-- cada fila de guias_generadas puede ahora traer el centro/contacto usado en
-- la guia, ademas de la categoria. Null para guias de formato largo antiguas
-- (un solo centro por corrida, ingresado a mano).
alter table guias_generadas
  add column if not exists centro text;
