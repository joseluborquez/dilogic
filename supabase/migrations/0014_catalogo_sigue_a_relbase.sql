-- El catalogo sigue a Relbase (decision de negocio, 24-oct-2026): Relbase es
-- la fuente de verdad de que codigos existen. Hasta ahora la sincronizacion
-- solo actualizaba product_id/precio de los codigos que encontraba, y un
-- codigo recodificado o reutilizado en Relbase quedaba apuntando al producto
-- equivocado sin que nadie se enterara (YDR_AS_011 "caja aislapol 70 lb"
-- termino emitiendose como "CAJA PLASTICA").
--
-- Cada sincronizacion completa ahora registra que vio de cada codigo en
-- Relbase, y al terminar bloquea los que ya no existen o estan deshabilitados
-- alla, y reactiva los que vuelven. Solo toca bloqueos hechos por la propia
-- sincronizacion: un bloqueo manual de un admin no se deshace solo.

alter table productos_catalogo
  -- Nombre del producto en Relbase tal cual (descripcion conserva el del Excel
  -- de carga). Se usa para advertir cuando el pedido trae otro nombre.
  add column if not exists nombre_relbase text,
  -- `enabled` del producto en Relbase la ultima vez que se vio.
  add column if not exists habilitado_relbase boolean,
  -- Por que esta inactivo, para mostrarlo al validar un pedido.
  add column if not exists motivo_bloqueo text,
  add column if not exists bloqueado_por text
    check (bloqueado_por in ('relbase', 'manual'));

-- Historial de sincronizaciones (manuales y la automatica diaria), para que
-- Catalogo muestre cuando corrio la ultima y que cambio.
create table if not exists sincronizaciones_catalogo (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('manual', 'automatica')),
  iniciada_en timestamptz not null,
  terminada_en timestamptz,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'ok', 'error')),
  -- { actualizados, insertados[], bloqueados[{sku,motivo}], reactivados[] }
  resumen jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sincronizaciones_catalogo_iniciada
  on sincronizaciones_catalogo (iniciada_en desc);

alter table sincronizaciones_catalogo enable row level security;

-- Los 5 bloqueados a mano el 24-oct responden justamente a Relbase (sus
-- codigos ya no existen alla): pasan a ser de la sincronizacion, que los
-- reactivara sola si el codigo vuelve a existir.
update productos_catalogo
   set bloqueado_por = 'relbase',
       motivo_bloqueo = 'El código ya no existe en Relbase (el producto tiene otro código).'
 where not activo
   and bloqueado_por is null
   and sku in ('CERQ_FV_090', 'MTX_AB_165', 'MTX_CC_034', 'YDR_AS_010', 'YDR_AS_011');
