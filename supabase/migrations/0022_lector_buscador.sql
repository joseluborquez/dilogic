-- Usuario de solo lectura para el buscador de productos (reporte de rentabilidad por centro):
-- lee número de guía, fecha, contacto (centro) y estado SII de ventas_guias. Nada más.
-- La clave se pone a mano en el editor SQL (alter role lector_buscador password '...').
-- Aplicada el 17-11-2026.
create role lector_buscador login nosuperuser nocreatedb nocreaterole noinherit;
alter role lector_buscador set statement_timeout = '15s';
grant usage on schema public to lector_buscador;
grant select (dte_id, fecha, customer_id, contacto, sii_status, anulada) on public.ventas_guias to lector_buscador;
create policy lector_buscador_lee on public.ventas_guias for select to lector_buscador using (true);
