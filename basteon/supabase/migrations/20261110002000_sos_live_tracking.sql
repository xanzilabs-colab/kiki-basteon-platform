-- Live SOS movement tracking: motion metadata on current alert snapshot and per-point history.

alter table public.alerts
  add column if not exists motion_state text check (motion_state in ('unknown', 'still', 'walking', 'vehicle')) default 'unknown',
  add column if not exists is_moving boolean not null default false,
  add column if not exists speed_kmh numeric(6,1),
  add column if not exists heading_deg smallint check (heading_deg between 0 and 359),
  add column if not exists motion_source text,
  add column if not exists motion_changed_at timestamptz,
  add column if not exists last_fix_at timestamptz,
  add column if not exists last_loc_src text,
  add column if not exists last_hdop numeric(4,1),
  add column if not exists is_simulated_loc boolean not null default false;

alter table public.alert_locations
  add column if not exists source text not null default 'band' check (source in ('band', 'phone')),
  add column if not exists speed_kmh numeric(6,1) check (speed_kmh is null or speed_kmh between 0 and 400),
  add column if not exists heading_deg smallint check (heading_deg is null or heading_deg between 0 and 359),
  add column if not exists motion_state text check (motion_state in ('unknown', 'still', 'walking', 'vehicle')),
  add column if not exists is_moving boolean not null default false,
  add column if not exists motion_src text,
  add column if not exists activity_mg integer check (activity_mg is null or activity_mg between 0 and 20000),
  add column if not exists sats smallint,
  add column if not exists hdop numeric(4,1);

alter table public.devices
  add column if not exists hw_gps boolean,
  add column if not exists hw_imu boolean,
  add column if not exists has_fix boolean,
  add column if not exists fw_version text,
  add column if not exists last_motion_state text,
  add column if not exists last_motion_at timestamptz;

drop function if exists public.record_panic_update(uuid, text, double precision, double precision, text, integer, integer, bigint);
create or replace function public.record_panic_update(
  p_alert_id uuid,
  p_device_id text,
  p_lat double precision,
  p_lng double precision,
  p_loc_source text,
  p_fix_age_s integer,
  p_battery integer,
  p_ctr bigint,
  p_source text default 'band',
  p_speed_kmh numeric default null,
  p_heading_deg integer default null,
  p_motion_state text default null,
  p_is_moving boolean default false,
  p_motion_src text default null,
  p_activity_mg integer default null,
  p_sats integer default null,
  p_hdop numeric default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motion_state text := case
    when p_motion_state in ('unknown', 'still', 'walking', 'vehicle') then p_motion_state
    else null
  end;
  v_heading smallint := case
    when p_heading_deg is not null and p_heading_deg between 0 and 359 then p_heading_deg::smallint
    else null
  end;
begin
  perform 1 from public.alerts
    where id = p_alert_id and device_id = p_device_id and status not in ('resolved', 'false_alarm')
    for update;
  if not found then return 'stop'; end if;

  update public.devices
  set last_ctr = p_ctr, last_seen_at = now()
  where device_id = p_device_id and last_ctr < p_ctr;
  if not found then return 'replayed'; end if;

  insert into public.alert_locations (
    alert_id, device_id, lat, lng, loc_source, fix_age_s, battery, ctr, source,
    speed_kmh, heading_deg, motion_state, is_moving, motion_src, activity_mg, sats, hdop
  )
  values (
    p_alert_id, p_device_id, p_lat, p_lng, p_loc_source, p_fix_age_s, p_battery, p_ctr, coalesce(p_source, 'band'),
    p_speed_kmh, v_heading, v_motion_state, coalesce(p_is_moving, false), p_motion_src, p_activity_mg, p_sats, p_hdop
  )
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
    battery = case when p_battery is not null and p_ctr > last_loc_ctr then p_battery else battery end,
    last_loc_ctr = case when p_lat is not null and p_lng is not null and p_ctr > last_loc_ctr then p_ctr else last_loc_ctr end,
    last_fix_at = case when p_lat is not null and p_lng is not null then now() else last_fix_at end,
    last_loc_src = coalesce(p_loc_source, last_loc_src),
    last_hdop = coalesce(p_hdop, last_hdop),
    speed_kmh = coalesce(p_speed_kmh, speed_kmh),
    heading_deg = coalesce(v_heading, heading_deg),
    motion_source = coalesce(p_motion_src, motion_source),
    is_moving = coalesce(p_is_moving, is_moving),
    is_simulated_loc = case when p_loc_source = 'dev' then true else is_simulated_loc end,
    motion_state = coalesce(v_motion_state, motion_state),
    motion_changed_at = case
      when v_motion_state is not null and v_motion_state is distinct from motion_state then now()
      else motion_changed_at
    end
  where id = p_alert_id;

  return 'recorded';
end;
$$;

revoke execute on function public.record_panic_update(uuid, text, double precision, double precision, text, integer, integer, bigint, text, numeric, integer, text, boolean, text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.record_panic_update(uuid, text, double precision, double precision, text, integer, integer, bigint, text, numeric, integer, text, boolean, text, integer, integer, numeric) to service_role;

alter table public.alert_locations replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.alert_locations;
exception
  when duplicate_object then null;
end $$;

