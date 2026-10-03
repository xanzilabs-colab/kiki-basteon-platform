alter table public.profiles add column if not exists ringtone_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kiki-ringtones', 'kiki-ringtones', false, 5242880, array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'];

drop policy if exists "ringtone_owner_select" on storage.objects;
drop policy if exists "ringtone_owner_insert" on storage.objects;
drop policy if exists "ringtone_owner_update" on storage.objects;
drop policy if exists "ringtone_owner_delete" on storage.objects;

create policy "ringtone_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ringtone_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ringtone_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ringtone_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = auth.uid()::text);