do $$ begin
  create type public.trip_mode as enum ('taxi', 'walk');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.trip_status as enum ('planned', 'active', 'concern', 'alert', 'arrived', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  destination_label text not null,
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  mode public.trip_mode not null,
  status public.trip_status not null default 'planned',
  planned_route jsonb not null,
  route_distance_m integer not null check (route_distance_m >= 0),
  route_duration_s integer not null check (route_duration_s >= 0),
  started_at timestamptz,
  expected_arrival_at timestamptz,
  last_heartbeat_at timestamptz,
  last_check_in_at timestamptz,
  next_check_in_at timestamptz,
  risk_score smallint not null default 0 check (risk_score between 0 and 100),
  route_watch_state text not null default 'normal' check (route_watch_state in ('normal', 'watch', 'concern', 'alert')),
  consented_at timestamptz,
  ended_at timestamptz,
  location_retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_locations (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real,
  speed_mps real,
  recorded_at timestamptz not null default now()
);

create table if not exists public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  event_type text not null,
  state text,
  risk_score smallint check (risk_score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text,
  relationship text,
  push_subscription_id uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.trip_share_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trips_owner_active_idx on public.trips (owner_id, status, created_at desc);
create index if not exists trip_locations_trip_time_idx on public.trip_locations (trip_id, recorded_at desc);
create index if not exists trip_events_trip_time_idx on public.trip_events (trip_id, created_at desc);
create index if not exists trusted_contacts_owner_idx on public.trusted_contacts (owner_id, enabled);
create index if not exists trip_share_links_trip_idx on public.trip_share_links (trip_id, expires_at);

create or replace function public.trips_before_update()
returns trigger language plpgsql as $$
begin
  new.owner_id := old.owner_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_trips_before_update on public.trips;
create trigger trg_trips_before_update before update on public.trips
  for each row execute function public.trips_before_update();

alter table public.trips enable row level security;
alter table public.trip_locations enable row level security;
alter table public.trip_events enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.trip_share_links enable row level security;

create policy trips_owner_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_staff());
create policy trip_locations_owner_select on public.trip_locations for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_locations.trip_id and (t.owner_id = auth.uid() or public.is_staff())));
create policy trip_events_owner_select on public.trip_events for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_events.trip_id and (t.owner_id = auth.uid() or public.is_staff())));
create policy trusted_contacts_owner_all on public.trusted_contacts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy trip_share_links_owner_select on public.trip_share_links for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_share_links.trip_id and t.owner_id = auth.uid()));

create or replace function public.hamba_stale_trip_candidates(p_before timestamptz)
returns table (trip_id uuid, owner_id uuid)
language sql security definer set search_path = public as $$
  select id, owner_id
  from public.trips
  where status in ('active', 'concern')
    and last_heartbeat_at < p_before
$$;

revoke execute on function public.hamba_stale_trip_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.hamba_stale_trip_candidates(timestamptz) to service_role;

alter table public.trips replica identity full;
alter publication supabase_realtime add table public.trips;