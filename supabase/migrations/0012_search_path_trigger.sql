-- El linter de Supabase marca las funciones sin search_path fijo: si alguna
-- vez esta pasa a SECURITY DEFINER, un search_path manipulable permitiria
-- resolver `now()` a una funcion plantada por otro rol. Hoy es SECURITY
-- INVOKER y el riesgo es teorico, pero fijarlo no cuesta nada.
alter function public.set_updated_at() set search_path = '';
