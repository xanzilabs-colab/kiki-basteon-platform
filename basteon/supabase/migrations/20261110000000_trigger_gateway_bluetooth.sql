-- Secure trigger gateway used by server-side bearer-token routes.
-- The bearer secret is never stored; only its SHA-256 digest is persisted.

create sequence if not exists public.trigger_alert_ctr_seq start with 4000000000000000000;

create table if not exists public.trigger_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (length(label) between 1 and 40),
  kind text not null check (kind in ('ios_shortcut','android_shortcut','watch','home_hub','android_shell','other')),
  countdown_s smallint not null default 10 check (countdown_s between 1 and 60),
  discreet boolean not null default false,
  allow_medical boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists trigger_tokens_user_created_idx
  on public.trigger_tokens (user_id, created_at desc);

create table if not exists public.pending_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid not null references public.trigger_tokens(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete restrict,
  source text not null check (source in ('webhook','watch','safe_point','guardian','soft','bt_media','bt_ble')),
  type_code text not null references public.emergency_types(code),
  discreet boolean not null default false,
  duress boolean not null default false,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 100000),
  loc_at timestamptz,
  trigger_pattern text check (trigger_pattern is null or length(trigger_pattern) <= 20),
  device_hint text check (device_hint is null or length(device_hint) <= 60),
  created_at timestamptz not null default now(),
  activates_at timestamptz not null,
  cancelled_at timestamptz,
  promoted_alert_id uuid references public.alerts(id) on delete set null
);

create index if not exists pending_alerts_due_idx
  on public.pending_alerts (activates_at)
  where cancelled_at is null and promoted_alert_id is null;
create index if not exists pending_alerts_user_recent_idx
  on public.pending_alerts (user_id, created_at desc)
  where cancelled_at is null and promoted_alert_id is null;

create table if not exists public.trigger_events (
  id bigint generated always as identity primary key,
  token_id uuid references public.trigger_tokens(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('fire','test','cancel','promoted','rejected')),
  reason text check (reason is null or length(reason) <= 60),
  pending_id uuid references public.pending_alerts(id) on delete set null,
  alert_id uuid references public.alerts(id) on delete set null,
  at timestamptz not null default now()
);

create index if not exists trigger_events_token_recent_idx
  on public.trigger_events (token_id, at desc);

alter table public.alerts
  add column if not exists trigger_source text,
  add column if not exists trigger_pattern text,
  add column if not exists device_hint text,
  add column if not exists duress boolean not null default false,
  add column if not exists accuracy_m real,
  add column if not exists loc_at timestamptz;

alter table public.devices
  add column if not exists is_virtual boolean not null default false;

create table if not exists public.trigger_virtual_endpoints (
  token_id uuid primary key references public.trigger_tokens(id) on delete cascade,
  device_id text not null unique references public.devices(device_id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on public.trigger_virtual_endpoints from public, anon, authenticated;
grant all on public.trigger_virtual_endpoints to service_role;

alter table public.alerts drop constraint if exists alerts_trigger_source_check;
alter table public.alerts add constraint alerts_trigger_source_check
  check (trigger_source is null or trigger_source in ('webhook','watch','safe_point','guardian','soft','bt_media','bt_ble'));
alter table public.alerts drop constraint if exists alerts_trigger_pattern_length_check;
alter table public.alerts add constraint alerts_trigger_pattern_length_check
  check (trigger_pattern is null or length(trigger_pattern) <= 20);
alter table public.alerts drop constraint if exists alerts_device_hint_length_check;
alter table public.alerts add constraint alerts_device_hint_length_check
  check (device_hint is null or length(device_hint) <= 60);
alter table public.alerts drop constraint if exists alerts_accuracy_m_range_check;
alter table public.alerts add constraint alerts_accuracy_m_range_check
  check (accuracy_m is null or accuracy_m between 0 and 100000);

create table if not exists public.shell_status (
  token_id uuid primary key references public.trigger_tokens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  armed boolean not null default false,
  test_mode boolean not null default false,
  app_version text,
  android_sdk integer,
  model text,
  battery_unrestricted boolean,
  last_seen timestamptz not null default now()
);

create table if not exists public.trigger_diagnostics (
  id bigint generated always as identity primary key,
  token_id uuid not null references public.trigger_tokens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  pattern text check (pattern is null or length(pattern) <= 20),
  origin text check (origin in ('key','session')),
  keycodes integer[] not null default '{}',
  device_hint text check (device_hint is null or length(device_hint) <= 60)
);
create index if not exists trigger_diag_token_at on public.trigger_diagnostics (token_id, at desc);
create index if not exists trigger_diag_user_at on public.trigger_diagnostics (user_id, at desc);

create table if not exists public.trigger_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid not null references public.trigger_tokens(id) on delete cascade,
  local_ref text not null check (length(local_ref) between 8 and 40),
  kind text not null check (kind in ('earbuds','wired','car','speaker','watch','ring','other')),
  label text not null check (length(label) between 1 and 40),
  status text not null check (status in ('connected','disconnected','untracked','bluetooth_off','permission_needed','unpaired')),
  battery_pct smallint check (battery_pct between 0 and 100),
  verified_at timestamptz,
  last_connected_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (token_id, local_ref)
);
alter table public.trigger_devices drop constraint if exists trigger_devices_kind_check;
alter table public.trigger_devices add constraint trigger_devices_kind_check
  check (kind in ('earbuds','wired','car','speaker','watch','ring','other'));
create index if not exists trigger_devices_user on public.trigger_devices (user_id);

alter table public.trigger_tokens enable row level security;
alter table public.pending_alerts enable row level security;
alter table public.trigger_events enable row level security;
alter table public.shell_status enable row level security;
alter table public.trigger_diagnostics enable row level security;
alter table public.trigger_devices enable row level security;

drop policy if exists shell_status_own on public.shell_status;
create policy shell_status_own on public.shell_status
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists trigger_diag_own on public.trigger_diagnostics;
create policy trigger_diag_own on public.trigger_diagnostics
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists trigger_devices_own on public.trigger_devices;
create policy trigger_devices_own on public.trigger_devices
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.trigger_tokens, public.pending_alerts, public.trigger_events,
  public.shell_status, public.trigger_diagnostics, public.trigger_devices
  from public, anon, authenticated;
grant select on public.shell_status, public.trigger_diagnostics, public.trigger_devices to authenticated;
grant all on public.trigger_tokens, public.pending_alerts, public.trigger_events,
  public.shell_status, public.trigger_diagnostics, public.trigger_devices to service_role;
grant usage, select on sequence public.trigger_alert_ctr_seq to service_role;

create or replace function public.trigger_token_create(
  p_user_id uuid,
  p_token_hash text,
  p_label text,
  p_kind text,
  p_countdown_s integer default 10,
  p_discreet boolean default false,
  p_allow_medical boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_device_id text;
begin
  if p_user_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 40 then
    raise exception 'invalid_label';
  end if;
  if p_kind is null or p_kind not in ('ios_shortcut','android_shortcut','watch','home_hub','android_shell','other') then
    raise exception 'invalid_kind';
  end if;
  if p_countdown_s is null or p_countdown_s not between 1 and 60 then
    raise exception 'invalid_countdown';
  end if;
  if p_kind <> 'android_shell' and not exists (
    select 1 from public.devices d where d.user_id = p_user_id and d.active and not d.is_virtual
  ) then
    raise exception 'no_active_device';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 731903);
  if (select count(*) from public.trigger_tokens t where t.user_id = p_user_id and t.revoked_at is null) >= 5 then
    raise exception 'token_limit';
  end if;

  insert into public.trigger_tokens (user_id, token_hash, label, kind, countdown_s, discreet, allow_medical)
  values (p_user_id, p_token_hash, btrim(p_label), p_kind, p_countdown_s, coalesce(p_discreet, false), coalesce(p_allow_medical, false))
  returning id into v_id;

  if p_kind = 'android_shell' then
    insert into public.devices (device_id, user_id, device_name, active, last_ctr, is_virtual)
    values (
      'TRIGGER-' || replace(v_id::text, '-', ''),
      p_user_id,
      'Phone safety trigger',
      true,
      0,
      true
    )
    returning device_id into v_device_id;
    insert into public.trigger_virtual_endpoints (token_id, device_id, user_id)
    values (v_id, v_device_id, p_user_id);
    insert into public.shell_status (token_id, user_id) values (v_id, p_user_id);
  end if;

  return jsonb_build_object('id', v_id, 'label', btrim(p_label), 'kind', p_kind, 'countdown_s', p_countdown_s,
    'discreet', coalesce(p_discreet, false), 'allow_medical', coalesce(p_allow_medical, false));
end;
$$;

create or replace function public.trigger_token_list(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'label', t.label,
    'kind', t.kind,
    'countdown_s', t.countdown_s,
    'discreet', t.discreet,
    'allow_medical', t.allow_medical,
    'created_at', t.created_at,
    'last_used_at', t.last_used_at,
    'revoked_at', t.revoked_at
  ) order by t.created_at desc), '[]'::jsonb)
  from public.trigger_tokens t
  where t.user_id = p_user_id
$$;

create or replace function public.trigger_token_revoke(p_user_id uuid, p_token_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.trigger_tokens%rowtype;
begin
  select * into v_token
  from public.trigger_tokens t
  where t.id = p_token_id and t.user_id = p_user_id and t.revoked_at is null
  for update;
  if not found then return false; end if;

  update public.trigger_tokens set revoked_at = now() where id = v_token.id;
  with cancelled as (
    update public.pending_alerts
    set cancelled_at = now()
    where token_id = v_token.id and cancelled_at is null and promoted_alert_id is null
    returning id
  )
  insert into public.trigger_events (token_id, user_id, kind, reason, pending_id)
  select v_token.id, v_token.user_id, 'cancel', 'token_revoked', cancelled.id from cancelled;
  return true;
end;
$$;

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

  insert into public.trigger_events (token_id, user_id, kind, pending_id)
  values (t.id, t.user_id, 'fire', p.id);

  return jsonb_build_object('ok', true, 'pending_id', p.id, 'activates_at', p.activates_at,
    'countdown_s', t.countdown_s, 'user_id', t.user_id);
end;
$$;

create or replace function public.trigger_cancel(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trigger_tokens%rowtype;
  v_pending_id uuid;
begin
  select * into t
  from public.trigger_tokens
  where token_hash = p_token_hash and revoked_at is null
  for update;
  if not found then raise exception 'invalid_token'; end if;

  with candidate as (
    select id
    from public.pending_alerts
    where token_id = t.id and user_id = t.user_id
      and cancelled_at is null and promoted_alert_id is null and activates_at > now()
    order by created_at desc
    limit 1
    for update
  )
  update public.pending_alerts p
  set cancelled_at = now()
  from candidate c
  where p.id = c.id
  returning p.id into v_pending_id;

  if v_pending_id is null then return jsonb_build_object('ok', false); end if;
  insert into public.trigger_events (token_id, user_id, kind, reason, pending_id)
  values (t.id, t.user_id, 'cancel', 'user_cancelled', v_pending_id);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.trigger_heartbeat(p_token_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trigger_tokens%rowtype;
  e jsonb;
  v_recent bigint;
  v_remaining integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_payload';
  end if;
  if p_payload ? 'events' and (
    jsonb_typeof(p_payload -> 'events') is distinct from 'array'
    or jsonb_array_length(p_payload -> 'events') > 20
  ) then
    raise exception 'invalid_events';
  end if;
  select * into t
  from public.trigger_tokens
  where token_hash = p_token_hash and revoked_at is null and kind = 'android_shell'
  for update;
  if not found then raise exception 'invalid_token'; end if;
  update public.trigger_tokens set last_used_at = now() where id = t.id;

  insert into public.shell_status
    (token_id, user_id, armed, test_mode, app_version, android_sdk, model, battery_unrestricted, last_seen)
  values
    (t.id, t.user_id,
     coalesce((p_payload ->> 'armed')::boolean, false),
     coalesce((p_payload ->> 'test')::boolean, false),
     left(p_payload ->> 'app_version', 20),
     nullif(p_payload ->> 'sdk', '')::integer,
     left(p_payload ->> 'model', 40),
     nullif(p_payload ->> 'battery_unrestricted', '')::boolean,
     now())
  on conflict (token_id) do update set
    armed = excluded.armed,
    test_mode = excluded.test_mode,
    app_version = excluded.app_version,
    android_sdk = excluded.android_sdk,
    model = excluded.model,
    battery_unrestricted = excluded.battery_unrestricted,
    last_seen = now();

  select count(*) into v_recent
  from public.trigger_diagnostics
  where token_id = t.id and at > now() - interval '1 hour';
  v_remaining := greatest(0, 500 - v_recent);

  if jsonb_typeof(p_payload -> 'events') = 'array' and v_remaining > 0 then
    for e in
      select value
        from jsonb_array_elements(p_payload -> 'events') with ordinality as event_items(value, ordinal)
      order by ordinal
      limit least(20, v_remaining)
    loop
      if jsonb_typeof(e) is distinct from 'object'
        or jsonb_typeof(e -> 'keys') is distinct from 'array'
        or jsonb_array_length(e -> 'keys') > 20 then
        raise exception 'invalid_diagnostic';
      end if;
      insert into public.trigger_diagnostics
        (token_id, user_id, at, pattern, origin, keycodes, device_hint)
      values (
        t.id,
        t.user_id,
        now(),
        left(e ->> 'pattern', 20),
        case when e ->> 'origin' in ('key','session') then e ->> 'origin' else null end,
        array(select value::integer from jsonb_array_elements_text(e -> 'keys') as keys(value)),
        left(e ->> 'device_hint', 60)
      );
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.trigger_devices_sync(p_token_hash text, p_devices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trigger_tokens%rowtype;
  d jsonb;
  v_refs text[] := '{}';
  v_status text;
  v_ref text;
begin
  if p_devices is null or jsonb_typeof(p_devices) is distinct from 'array' then
    raise exception 'invalid_devices';
  end if;
  if jsonb_array_length(p_devices) > 10 then
    raise exception 'invalid_devices';
  end if;
  select * into t
  from public.trigger_tokens
  where token_hash = p_token_hash and revoked_at is null and kind = 'android_shell'
  for update;
  if not found then raise exception 'invalid_token'; end if;

  for d in select value from jsonb_array_elements(p_devices) loop
    if jsonb_typeof(d) is distinct from 'object' then raise exception 'invalid_device'; end if;
    v_ref := d ->> 'ref';
    v_status := d ->> 'status';
    insert into public.trigger_devices
      (user_id, token_id, local_ref, kind, label, status, battery_pct, verified_at, last_connected_at, last_seen_at)
    values
      (t.user_id, t.id, v_ref, d ->> 'kind', d ->> 'label', v_status,
       nullif(d ->> 'battery', '')::smallint, nullif(d ->> 'verified_at', '')::timestamptz,
       case when v_status = 'connected' then now() end, now())
    on conflict (token_id, local_ref) do update set
      kind = excluded.kind,
      label = excluded.label,
      status = excluded.status,
      battery_pct = excluded.battery_pct,
      verified_at = excluded.verified_at,
      last_connected_at = case when excluded.status = 'connected' then now()
        else public.trigger_devices.last_connected_at end,
      last_seen_at = now();
    v_refs := array_append(v_refs, v_ref);
  end loop;

  delete from public.trigger_devices
  where token_id = t.id and not (local_ref = any (v_refs));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.trigger_promote_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pending_alerts%rowtype;
  v_alert_id uuid;
  v_ctr bigint;
  v_ids uuid[] := '{}';
begin
  for p in
    select *
    from public.pending_alerts
    where cancelled_at is null and promoted_alert_id is null and activates_at <= now()
    order by activates_at, created_at
    limit 100
    for update skip locked
  loop
    v_ctr := -nextval('public.trigger_alert_ctr_seq'::regclass);
    insert into public.alerts
      (device_id, ctr, lat, lng, loc_source, accuracy_m, loc_at, type_code,
       type_source, type_updated_at, trigger_source, trigger_pattern, device_hint, duress)
    values
      (p.device_id, v_ctr, p.lat, p.lng,
       case when p.lat is null then null else 'gps' end,
       p.accuracy_m, p.loc_at, p.type_code, 'device', now(),
       p.source, p.trigger_pattern, p.device_hint, p.duress)
    returning id into v_alert_id;

    update public.pending_alerts set promoted_alert_id = v_alert_id where id = p.id;
    insert into public.trigger_events (token_id, user_id, kind, pending_id, alert_id)
    values (p.token_id, p.user_id, 'promoted', p.id, v_alert_id);
    v_ids := array_append(v_ids, v_alert_id);
  end loop;

  return jsonb_build_object('count', cardinality(v_ids), 'alert_ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.trigger_prune_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_diagnostics integer;
  v_events integer;
begin
  with old_rows as (
    select ctid from public.trigger_diagnostics
    where at < now() - interval '30 days'
    order by at
    limit 5000
  )
  delete from public.trigger_diagnostics d using old_rows
  where d.ctid = old_rows.ctid;
  get diagnostics v_diagnostics = row_count;

  with old_rows as (
    select ctid from public.trigger_events
    where at < now() - interval '30 days'
    order by at
    limit 5000
  )
  delete from public.trigger_events e using old_rows
  where e.ctid = old_rows.ctid;
  get diagnostics v_events = row_count;

  return jsonb_build_object('diagnostics_pruned', v_diagnostics, 'events_pruned', v_events);
end;
$$;

revoke all on function public.trigger_token_create(uuid,text,text,text,integer,boolean,boolean) from public, anon, authenticated;
revoke all on function public.trigger_token_list(uuid) from public, anon, authenticated;
revoke all on function public.trigger_token_revoke(uuid,uuid) from public, anon, authenticated;
revoke all on function public.trigger_fire(text,jsonb) from public, anon, authenticated;
revoke all on function public.trigger_cancel(text) from public, anon, authenticated;
revoke all on function public.trigger_heartbeat(text,jsonb) from public, anon, authenticated;
revoke all on function public.trigger_devices_sync(text,jsonb) from public, anon, authenticated;
revoke all on function public.trigger_promote_due() from public, anon, authenticated;
revoke all on function public.trigger_prune_diagnostics() from public, anon, authenticated;
grant execute on function public.trigger_token_create(uuid,text,text,text,integer,boolean,boolean) to service_role;
grant execute on function public.trigger_token_list(uuid) to service_role;
grant execute on function public.trigger_token_revoke(uuid,uuid) to service_role;
grant execute on function public.trigger_fire(text,jsonb) to service_role;
grant execute on function public.trigger_cancel(text) to service_role;
grant execute on function public.trigger_heartbeat(text,jsonb) to service_role;
grant execute on function public.trigger_devices_sync(text,jsonb) to service_role;
grant execute on function public.trigger_promote_due() to service_role;
grant execute on function public.trigger_prune_diagnostics() to service_role;
