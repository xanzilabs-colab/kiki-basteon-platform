create table if not exists public.trigger_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid not null references public.trigger_tokens(id) on delete cascade,
  local_id text not null check (length(local_id) between 8 and 40),
  name text not null check (length(name) between 1 and 40),
  kind text not null check (kind in ('earbuds','wired','car','speaker','watch','ring','other')),
  device_ref text check (device_ref is null or length(device_ref) <= 64),
  gap_ms int not null check (gap_ms between 200 and 1500),
  settle_ms int not null check (settle_ms between 300 and 2500),
  mapping jsonb not null default '{}',
  library jsonb not null default '[]',
  verified_at timestamptz,
  app_version text,
  android_sdk int,
  updated_at timestamptz not null default now(),
  unique (token_id, local_id)
);

create table if not exists public.trigger_compat_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  phone_model text check (length(phone_model) <= 40),
  android_sdk int,
  accessory_kind text,
  summary jsonb not null
);

alter table public.trigger_profiles enable row level security;
alter table public.trigger_compat_reports enable row level security;
revoke all on public.trigger_profiles, public.trigger_compat_reports from public, anon, authenticated;
grant all on public.trigger_profiles, public.trigger_compat_reports to service_role;

create or replace function public.trigger_fire(p_token_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trigger_tokens%rowtype;
  v_type text;
  v_test boolean;
  v_duress boolean;
  v_lat double precision;
  v_lng double precision;
  v_accuracy real;
  v_loc_at timestamptz;
  v_source text;
  v_pattern text;
  v_profile text;
  v_reason text;
  v_hint text;
  v_recent bigint;
  v_device_id text;
  p public.pending_alerts%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_payload';
  end if;

  select * into t
  from public.trigger_tokens
  where token_hash = p_token_hash and revoked_at is null
  for update;
  if not found then raise exception 'invalid_token'; end if;
  update public.trigger_tokens set last_used_at = now() where id = t.id;

  v_test := coalesce((p_payload ->> 'test')::boolean, false);
  if v_test then
    insert into public.trigger_events (token_id, user_id, kind) values (t.id, t.user_id, 'test');
    return jsonb_build_object('ok', true, 'test', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(t.user_id::text), 731902);
  select * into p
  from public.pending_alerts
  where user_id = t.user_id and cancelled_at is null and promoted_alert_id is null
    and created_at > now() - interval '60 seconds'
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('ok', true, 'reused', true, 'pending_id', p.id,
      'activates_at', p.activates_at, 'countdown_s', greatest(0, ceil(extract(epoch from p.activates_at - now()))::integer),
      'user_id', t.user_id);
  end if;

  select count(*) into v_recent
  from public.trigger_events
  where token_id = t.id and kind = 'fire' and at > now() - interval '10 minutes';
  if v_recent >= 5 then
    if not exists (
      select 1 from public.trigger_events
      where token_id = t.id and kind = 'rejected' and reason = 'rate_limited'
        and at > now() - interval '10 minutes'
    ) then
      insert into public.trigger_events (token_id, user_id, kind, reason)
      values (t.id, t.user_id, 'rejected', 'rate_limited');
    end if;
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select d.device_id into v_device_id
  from public.devices d
  where d.user_id = t.user_id and d.active and not d.is_virtual
  order by d.created_at desc, d.device_id
  limit 1;
  if v_device_id is null and t.kind = 'android_shell' then
    select e.device_id into v_device_id
    from public.trigger_virtual_endpoints e
    where e.token_id = t.id and e.user_id = t.user_id;
  end if;
  if v_device_id is null then raise exception 'no_active_device'; end if;

  v_type := public.resolve_emergency_type(coalesce(p_payload ->> 'type', 'sos'));
  if v_type = 'medical' and not t.allow_medical then
    v_type := public.resolve_emergency_type('sos');
  end if;
  v_duress := coalesce((p_payload ->> 'duress')::boolean, false);
  v_lat := nullif(p_payload ->> 'lat', '')::double precision;
  v_lng := nullif(p_payload ->> 'lng', '')::double precision;
  v_accuracy := nullif(p_payload ->> 'accuracy_m', '')::real;
  v_loc_at := nullif(p_payload ->> 'loc_at', '')::timestamptz;
  if (v_lat is null) <> (v_lng is null) then
    v_lat := null;
    v_lng := null;
    v_accuracy := null;
    v_loc_at := null;
  end if;
  v_pattern := left(nullif(btrim(p_payload ->> 'pattern'), ''), 20);
  v_profile := nullif(left(btrim(coalesce(p_payload ->> 'profile', '')), 12), '');
  v_reason := case
    when v_profile is null then null
    when coalesce((p_payload ->> 'sig_verified')::boolean, false)
      then left('gesture:' || v_profile || ':verified', 60)
    else left('gesture:' || v_profile || ':unverified', 60)
  end;
  v_source := case
    when t.kind = 'android_shell' and p_payload ->> 'src' = 'bt_ble' then 'bt_ble'
    when t.kind = 'android_shell' then 'bt_media'
    when t.kind in ('ios_shortcut','android_shortcut','home_hub','other') then 'webhook'
    else 'watch'
  end;
  v_hint := case
    when v_source = 'bt_media' then 'Bluetooth media key'
    when v_source = 'bt_ble' then 'Bluetooth LE'
    else null
  end;

  insert into public.pending_alerts
    (user_id, token_id, device_id, source, type_code, discreet, duress, lat, lng,
     accuracy_m, loc_at, trigger_pattern, device_hint, created_at, activates_at)
  values
    (t.user_id, t.id, v_device_id, v_source, v_type, t.discreet, v_duress, v_lat, v_lng,
     v_accuracy, v_loc_at, v_pattern, v_hint, now(), now() + make_interval(secs => t.countdown_s))
  returning * into p;

  insert into public.trigger_events (token_id, user_id, kind, reason, pending_id)
  values (t.id, t.user_id, 'fire', v_reason, p.id);

  return jsonb_build_object('ok', true, 'pending_id', p.id, 'activates_at', p.activates_at,
    'countdown_s', t.countdown_s, 'user_id', t.user_id);
end;
$$;
