-- Tipo «traspaso» (Hugo, 17-11-2026): se factura (cuenta en lo facturado de Dilogic), pero no son productos propios
-- ni dejan ganancia: fuera de la venta propia, la ganancia y el margen. Palvitad (Yadran) es traspaso.
-- Aplicada el 17-11-2026.
alter table public.centros drop constraint if exists centros_tipo_check;
alter table public.centros add constraint centros_tipo_check check (tipo in ('centro', 'otros', 'bins', 'fuera', 'traspaso'));
update public.centros set tipo = 'traspaso', nota = 'traspaso de costos: se factura, no es venta propia (Hugo, 17-11)'
 where customer_id = 11344997 and contacto = 'PALVITAD';
