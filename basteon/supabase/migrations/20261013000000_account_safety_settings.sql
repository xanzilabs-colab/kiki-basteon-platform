alter table public.profiles
  add column if not exists dark_theme boolean not null default false,
  add column if not exists safety_pin_set_at timestamptz;

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  phone text,
  relationship text,
  created_at timestamptz not null default now()
);
create index if not exists guardians_owner_idx on public.guardians(owner_id, created_at);

create table if not exists public.medical_profiles (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  allergies text,
  conditions text,
  medications text,
  blood_type text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.guardians enable row level security;
alter table public.medical_profiles enable row level security;

create policy guardians_owner_all on public.guardians for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy medical_profiles_owner_all on public.medical_profiles for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());