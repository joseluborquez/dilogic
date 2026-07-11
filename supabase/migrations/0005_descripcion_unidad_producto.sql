-- Campo aparte del nombre del producto: nota corta de unidad/empaque
-- (ej. "1 lt. Bot.", "UN") que Relbase guarda en el atributo "description"
-- de cada producto (GET /productos), distinto de "name". Se imprime en la
-- columna "Descripcion" del formulario manual de Relbase; nuestro
-- productos_catalogo.descripcion ya representa el "name" (nombre visible
-- del producto), asi que se necesita una columna nueva para esto.
alter table productos_catalogo
  add column if not exists descripcion_relbase text;
