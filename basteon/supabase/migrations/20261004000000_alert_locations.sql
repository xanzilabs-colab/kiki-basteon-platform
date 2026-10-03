alter table public.alerts
  add column if not exists last_location_at timestamptz,
  add column if not exists last_loc_ctr bigint not null default 0,
  add column if not exists update_count integer not null default 0;

create table if not exists public.alert_locations (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete restrict,
  lat double precision,
  lng double precision,
  loc_source text,
  fix_age_s integer,
  battery integer,
  ctr bigint not null,
  recorded_at timestamptz not null default now(),
  constraint alert_locations_alert_ctr_unique unique (alert_id, ctr),
  constraint alert_locations_lat_range check (lat is null or lat between -90 and 90),
  constraint alert_locations_lng_range check (lng is null or lng between -180 and 180),
  constraint alert_locations_source_check check (loc_source is null or loc_source in ('gps', 'stale', 'cached', 'dev'))
);

create index if not exists alert_locations_alert_recorded_idx
  on public.alert_locations (alert_id, recorded_at desc);

alter table public.alert_locations enable row level security;

drop policy if exists alert_locations_staff_select on public.alert_locations;
create policy alert_locations_staff_select on public.alert_locations for select to authenticated
  using (public.is_staff());

alter table public.alert_locations replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.alert_locations;
exception
  when duplicate_object then null;
end $$;

create or replace function public.record_panic_update(
  p_alert_id uuid,
  p_device_id text,
  p_lat double precision,
  p_lng double precision,
  p_loc_source text,
  p_fix_age_s integer,
  p_battery integer,
  p_ctr bigint
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.alerts
    where id = p_alert_id and device_id = p_device_id and status not in ('resolved', 'false_alarm')
    for update;
  if not found then return 'stop'; end if;

  update public.devices
  set last_ctr = p_ctr, last_seen_at = now()
  where device_id = p_device_id and last_ctr < p_ctr;
  if not found then return 'replayed'; end if;

  insert into public.alert_locations (alert_id, device_id, lat, lng, loc_source, fix_age_s, battery, ctr)
  values (p_alert_id, p_device_id, p_lat, p_lng, p_loc_source, p_fix_age_s, p_battery, p_ctr)
  on conflict (alert_id, ctr) do nothing;
  if not found then return 'replayed'; end if;

  update public.alerts
  set
    update_count = update_count + 1,
    last_location_at = now(),
    lat = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_lat else lat end,
    lng = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_lng else lng end,
    loc_source = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_loc_source else loc_source end,
    fix_age_s = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_fix_age_s else fix_age_s end,
    battery = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_battery else battery end,
    last_loc_ctr = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_ctr else last_loc_ctr end
  where id = p_alert_id;

  return 'recorded';
end;
$$;

revoke execute on function public.record_panic_update(uuid, text, double precision, double precision, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.record_panic_update(uuid, text, double precision, double precision, text, integer, integer, bigint) to service_role;

-- Location history may be pruned after the chosen operational retention period.