alter type public.trip_mode add value if not exists 'cycling';

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('buddy_bubble', 'system', 'safety_intel', 'trip_checkpoint'));

create table if not exists public.user_privacy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  live_location_sharing boolean not null default false,
  safety_intel_alerts boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_privacy_settings enable row level security;
revoke all on public.user_privacy_settings from anon, authenticated;

create table if not exists public.community_intel_records (
  id uuid primary key default gen_random_uuid(),
  source_alert_id uuid not null unique,
  reporter_id uuid,
  kind text not null check (kind in ('unsafe_area','poor_lighting','harassment','road_hazard')),
  lat double precision not null,
  lng double precision not null,
  summary text not null default '',
  status text not null default 'unverified' check (status in ('unverified','corroborated','verified','rejected')),
  incident_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists community_intel_active_idx on public.community_intel_records (expires_at, lat, lng) where status <> 'rejected';
alter table public.community_intel_records enable row level security;
revoke all on public.community_intel_records from anon, authenticated;

create table if not exists public.safety_intel_alert_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.community_intel_records(id) on delete cascade,
  zone text not null check (zone in ('near','outer')),
  sent_at timestamptz not null default now()
);
create index if not exists safety_intel_alert_log_user_idx on public.safety_intel_alert_log (user_id, sent_at desc);
alter table public.safety_intel_alert_log enable row level security;
revoke all on public.safety_intel_alert_log from anon, authenticated;

create table if not exists public.trip_checkpoints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  position integer not null,
  lat double precision not null,
  lng double precision not null,
  label text,
  expected_at timestamptz,
  status text not null default 'pending' check (status in ('pending','prompted','checked_in','missed','escalated','skipped')),
  reminders_sent integer not null default 0,
  last_notified_at timestamptz,
  checked_in_at timestamptz,
  unique (trip_id, position)
);
alter table public.trip_checkpoints enable row level security;
revoke all on public.trip_checkpoints from anon, authenticated;
create policy trip_checkpoints_owner_read on public.trip_checkpoints for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()));
grant select on public.trip_checkpoints to authenticated;

alter table public.trips add column if not exists route_tools text[] not null default '{}';

create policy notifications_owner_read on public.notifications for select to authenticated using (user_id = auth.uid());
grant select on public.notifications to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;
