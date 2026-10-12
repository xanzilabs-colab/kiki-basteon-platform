insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organisation-logos', 'organisation-logos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

update public.buddy_trips set avatar = '🧭' where avatar = '⭐';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'responder_presence'
     ) then
    alter publication supabase_realtime add table public.responder_presence;
  end if;
end;
$$;
