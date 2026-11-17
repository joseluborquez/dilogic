-- Paso 1 de la unificación (17-11-2026): el buscador copia las ventas desde esta base en vez de relBase.
-- lector_buscador sigue siendo solo lectura: más columnas de ventas_guias y los productos de cada guía.
-- Aplicada el 17-11-2026.
grant select (folio, type_transfer, monto_neto, lineas_cargadas, actualizado_en) on public.ventas_guias to lector_buscador;
grant select (dte_id, linea, product_id, codigo, nombre, cantidad, precio, descuento, monto_neto) on public.ventas_lineas to lector_buscador;
create policy lector_buscador_lee on public.ventas_lineas for select to lector_buscador using (true);
