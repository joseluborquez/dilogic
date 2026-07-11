-- Ruta (no URL firmada, que expira) del PDF de la guia en Supabase Storage
-- (bucket privado "guias-pdf"), descargado desde Relbase tras crear el DTE.
alter table guias_generadas
  add column if not exists pdf_path text;

-- Bucket privado: las URLs de acceso se firman al vuelo (ver
-- src/lib/storage/guias-pdf.ts), nunca publicas, por tratarse de documentos
-- tributarios. Solo el service_role (server-side) escribe/lee aqui.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guias-pdf', 'guias-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
