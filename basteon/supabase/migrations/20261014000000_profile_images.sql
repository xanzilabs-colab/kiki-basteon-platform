alter table public.profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kiki-profile-images', 'kiki-profile-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "profile_image_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'kiki-profile-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy "profile_image_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'kiki-profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_image_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'kiki-profile-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'kiki-profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_image_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kiki-profile-images' and (storage.foldername(name))[1] = auth.uid()::text);