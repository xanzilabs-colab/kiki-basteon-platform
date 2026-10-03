create table if not exists public.ringtones (
  id text primary key,
  name text not null,
  storage_path text not null unique,
  is_stock boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists ringtone_id text references public.ringtones(id) on delete set null;

alter table public.ringtones enable row level security;

drop policy if exists "ringtone_catalog_select" on public.ringtones;
create policy "ringtone_catalog_select" on public.ringtones for select to authenticated using (true);

drop policy if exists "ringtone_stock_select" on storage.objects;
create policy "ringtone_stock_select" on storage.objects for select to authenticated
  using (bucket_id = 'kiki-ringtones' and (storage.foldername(name))[1] = 'stock');