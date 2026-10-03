create extension if not exists pgcrypto;

-- ───────── Types ─────────
create type public.user_role as enum ('admin', 'responder', 'user');
create type public.alert_status as enum ('new', 'acknowledged', 'enroute', 'on_scene', 'resolved', 'false_alarm');

-- ───────── Profiles ─────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Role helpers (security definer = no RLS recursion) ─────────
create or replace function public.app_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin', 'responder'), false)
$$;

-- ───────── Devices ─────────
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,                      -- ESP32 MAC without colons, e.g. A1B2C3D4E5F6
  user_id uuid references public.profiles(id) on delete set null,   -- device owner
  device_name text not null default 'Secure Panic Unit',
  active boolean not null default true,
  last_ctr bigint not null default 0,                  -- replay protection; reset to 0 only if device NVS is wiped
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Per-device AES-256 keys. RLS on, NO policies: only the service role can read.
create table public.device_secrets (
  device_id text primary key references public.devices(device_id) on delete cascade,
  key_b64 text not null,                               -- base64 of the 32-byte key
  created_at timestamptz not null default now()
);
revoke all on public.device_secrets from anon, authenticated;

-- ───────── Alerts ─────────
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.devices(device_id) on delete restrict,
  ctr bigint not null,
  status public.alert_status not null default 'new',
  lat double precision,
  lng double precision,
  loc_source text,                                     -- gps | stale | cached | dev
  fix_age_s integer,                                   -- age of the GPS fix in seconds (null = unknown)
  battery smallint,
  assigned_to uuid references public.profiles(id) on delete set null,
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  enroute_at timestamptz,
  on_scene_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint alerts_device_ctr_unique unique (device_id, ctr),
  constraint alerts_lat_range check (lat is null or lat between -90 and 90),
  constraint alerts_lng_range check (lng is null or lng between -180 and 180),
  constraint alerts_loc_source_check check (loc_source is null or loc_source in ('gps','stale','cached','dev'))
);

create index alerts_status_triggered_idx on public.alerts (status, triggered_at desc);
create index alerts_device_idx on public.alerts (device_id);

-- ───────── Audit trail ─────────
create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  from_status public.alert_status,
  to_status public.alert_status not null,
  note text,
  created_at timestamptz not null default now()
);
create index alert_events_alert_idx on public.alert_events (alert_id, created_at);

-- ───────── Triggers ─────────
create or replace function public.alerts_before_update()
returns trigger language plpgsql as $$
begin
  -- immutable fields
  new.device_id    := old.device_id;
  new.ctr          := old.ctr;
  new.triggered_at := old.triggered_at;
  new.updated_at   := now();

  if new.status is distinct from old.status then
    case new.status
      when 'acknowledged' then new.acknowledged_at := coalesce(new.acknowledged_at, now());
      when 'enroute'      then new.enroute_at := now();
      when 'on_scene'     then new.on_scene_at := now();
      when 'resolved'     then new.resolved_at := now();
      when 'false_alarm'  then new.resolved_at := now();
      else null;
    end case;

    if new.assigned_to is null and auth.uid() is not null
       and new.status in ('acknowledged', 'enroute', 'on_scene') then
      new.assigned_to := auth.uid();
    end if;
  end if;
  return new;
end $$;

create trigger trg_alerts_before_update
  before update on public.alerts
  for each row execute function public.alerts_before_update();

create or replace function public.alerts_log_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.alert_events (alert_id, actor_id, from_status, to_status, note)
    values (new.id, null, null, new.status, 'Alert triggered by device');
  elsif new.status is distinct from old.status then
    insert into public.alert_events (alert_id, actor_id, from_status, to_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end $$;

create trigger trg_alerts_log_event
  after insert or update on public.alerts
  for each row execute function public.alerts_log_event();

-- ───────── Row Level Security ─────────
alter table public.profiles       enable row level security;
alter table public.devices        enable row level security;
alter table public.device_secrets enable row level security;
alter table public.alerts         enable row level security;
alter table public.alert_events   enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.app_role());   -- cannot self-promote
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- devices
create policy devices_select on public.devices for select to authenticated
  using (public.is_staff() or user_id = auth.uid());
create policy devices_admin_write on public.devices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- alerts (inserts only via service role / Edge Function)
create policy alerts_select on public.alerts for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.devices d where d.device_id = alerts.device_id and d.user_id = auth.uid())
  );
create policy alerts_staff_update on public.alerts for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- alert_events
create policy alert_events_select on public.alert_events for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.alerts a
      join public.devices d on d.device_id = a.device_id
      where a.id = alert_events.alert_id and d.user_id = auth.uid()
    )
  );
create policy alert_events_staff_insert on public.alert_events for insert to authenticated
  with check (public.is_staff() and actor_id = auth.uid());

-- ───────── Realtime ─────────
alter table public.alerts replica identity full;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.alert_events;

-- ───────── After first signup, promote yourself (run manually) ─────────
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'YOU@EXAMPLE.COM');

-- ───────── Dev seed (replace with the ID printed in the ESP32 Serial Monitor: "Boot ok, id: ...") ─────────
-- insert into public.devices (device_id, device_name) values ('REPLACE_WITH_ESP32_ID', 'Dev Panic Unit');
-- insert into public.device_secrets (device_id, key_b64)
--   values ('REPLACE_WITH_ESP32_ID', 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=');  -- = ASCII "12345678901234567890123456789012" (dev only)