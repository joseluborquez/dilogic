-- Tokens de la API v1 de Relbase (uno por empresa, cifrados). La v1 se retiro
-- en oct-2026 y la app usa solo OAuth v2 (relbase_conexion, migracion 0013),
-- asi que esta tabla ya no sirve para volver atras: solo guarda credenciales
-- que nadie lee. Menos secretos guardados es menos que se pueda filtrar.
drop table if exists public.credenciales_relbase;
