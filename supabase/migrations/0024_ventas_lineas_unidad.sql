-- Unidad de venta de cada línea (unit_item de relBase: "KG", "UN"...), para el buscador de productos (17-11-2026).
-- Se llena desde la sincronización en las guías nuevas; las antiguas quedan sin unidad (el buscador ya la tiene).
-- Aplicada el 17-11-2026.
alter table public.ventas_lineas add column if not exists unidad text;
grant select (unidad) on public.ventas_lineas to lector_buscador;
