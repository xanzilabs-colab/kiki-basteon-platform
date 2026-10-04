-- PIN-locked bands (firmware v2.6+).
-- The server keeps its own scrypt hash of the owner's band PIN (computed by the Next.js server, never by
-- the browser). The band keeps a separate PBKDF2 verifier. Only the service role can read either.
-- Rules enforced here:
--   * an owned band without a PIN can never be taken over by another account;
--   * an owned, PIN-locked band can only be transferred with a link token that was issued after the
--     current PIN was verified, and never while the band has an active alert;
--   * any ownership change drops the server PIN (the band wipes its own PIN when it links).
-- Idempotent: safe to run more than once.

alter table public.devices
  add column if not exists pin_locked boolean not null default false,
  add column if not exists pin_set_at timestamptz,
  add column if not exists band_pin_locked boolean,
  add column if not exists band_lock_reported_at timestamptz;

create table if not exists public.device_pins (
  device_id text primary key references public.devices(device_id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_pins drop constraint if exists device_pins_hash_format;
alter table public.device_pins add constraint device_pins_hash_format check (pin_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$');
alter table public.device_pins drop constraint if exists device_pins_attempts_range;
alter table public.device_pins add constraint device_pins_attempts_range check (failed_attempts between 0 and 1000);

alter table public.device_pins enable row level security;
revoke all on public.device_pins from anon, authenticated;

create table if not exists public.device_security_events (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.devices(device_id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.device_security_events drop constraint if exists device_security_events_event_check;
alter table public.device_security_events add constraint device_security_events_event_check check (event in (
  'pin_set', 'pin_changed', 'pin_removed', 'pin_failed', 'pin_locked_out',
  'unlinked', 'transfer_authorized', 'transferred',
  'admin_pin_reset', 'admin_lockout_cleared', 'admin_owner_changed'
));
create index if not exists device_security_events_device_idx on public.device_security_events (device_id, created_at desc);
alter table public.device_security_events enable row level security;
revoke all on public.device_security_events from anon, authenticated;

alter table public.device_link_tokens
  add column if not exists transfer_from uuid references public.profiles(id) on delete set null,
  add column if not exists pin_verified_at timestamptz;

-- Keep devices.pin_locked / pin_set_at (owner-visible, no secrets) in step with device_pins.
create or replace function public.device_pins_sync_device()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_device text := coalesce(new.device_id, old.device_id);
begin
  update public.devices d
  set pin_locked = exists (select 1 from public.device_pins p where p.device_id = v_device),
      pin_set_at = (select p.set_at from public.device_pins p where p.device_id = v_device)
  where d.device_id = v_device;
  return null;
end;
$$;

drop trigger if exists trg_device_pins_sync_device on public.device_pins;
create trigger trg_device_pins_sync_device
  after insert or update or delete on public.device_pins
  for each row execute function public.device_pins_sync_device();

-- A new owner (or no owner) never inherits the previous owner's PIN. AFTER trigger: the sync trigger
-- above then updates this same devices row, which a BEFORE trigger would not allow.
create or replace function public.devices_drop_pin_on_owner_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then
    delete from public.device_pins where device_id = new.device_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_devices_drop_pin_on_owner_change on public.devices;
create trigger trg_devices_drop_pin_on_owner_change
  after update of user_id on public.devices
  for each row execute function public.devices_drop_pin_on_owner_change();

-- Bring existing rows in line (no-op on a fresh install).
update public.devices d
set pin_locked = exists (select 1 from public.device_pins p where p.device_id = d.device_id)
where d.pin_locked is distinct from exists (select 1 from public.device_pins p where p.device_id = d.device_id);

-- Atomically reserve one PIN attempt before the caller verifies the hash. Every attempt is counted as a
-- failure up front, so parallel guesses cannot exceed the limit; a correct PIN then calls
-- device_pin_attempt_succeeded() to reset the counter. 5 attempts, then a 15 minute lockout.
create or replace function public.device_pin_begin_attempt(p_device_id text)
returns table (result text, pin_hash text, attempts_left integer, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row public.device_pins%rowtype;
  v_failed integer;
  v_max constant integer := 5;
  v_lock constant interval := interval '15 minutes';
begin
  select * into v_row from public.device_pins p where p.device_id = p_device_id for update;
  if not found then
    return query select 'no_pin'::text, null::text, null::integer, null::integer;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query select 'locked_out'::text, null::text, 0,
      greatest(1, ceil(extract(epoch from v_row.locked_until - now()))::integer);
    return;
  end if;

  v_failed := case when v_row.locked_until is not null then 0 else v_row.failed_attempts end + 1;

  update public.device_pins p
  set failed_attempts = least(v_failed, 1000),
      locked_until = case when v_failed >= v_max then now() + v_lock else null end,
      updated_at = now()
  where p.device_id = p_device_id;

  return query select 'ok'::text, v_row.pin_hash, greatest(v_max - v_failed, 0), null::integer;
end;
$$;

create or replace function public.device_pin_attempt_succeeded(p_device_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.device_pins
  set failed_attempts = 0, locked_until = null, updated_at = now()
  where device_id = p_device_id;
$$;

revoke all on function public.device_pin_begin_attempt(text) from public, anon, authenticated;
grant execute on function public.device_pin_begin_attempt(text) to service_role;
revoke all on function public.device_pin_attempt_succeeded(text) from public, anon, authenticated;
grant execute on function public.device_pin_attempt_succeeded(text) to service_role;

-- Store a server PIN hash only while p_owner still owns the band (row-locked, so it can't race a transfer).
-- p_mode: 'create' (fails if a PIN exists) or 'replace' (fails if none exists).
create or replace function public.device_pin_store(p_device_id text, p_owner uuid, p_pin_hash text, p_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.devices where device_id = p_device_id for update;
  if not found or v_owner is distinct from p_owner then return 'not_owner'; end if;

  if p_mode = 'create' then
    insert into public.device_pins (device_id, owner_id, pin_hash)
    values (p_device_id, p_owner, p_pin_hash)
    on conflict (device_id) do nothing;
    if not found then return 'exists'; end if;
  elsif p_mode = 'replace' then
    update public.device_pins
    set pin_hash = p_pin_hash, owner_id = p_owner, set_at = now(), failed_attempts = 0, locked_until = null, updated_at = now()
    where device_id = p_device_id;
    if not found then return 'no_pin'; end if;
  else
    raise exception 'invalid mode';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.device_pin_store(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.device_pin_store(text, uuid, text, text) to service_role;

-- Same signature as before; adds the PIN-gated transfer path and the active-alert block.
create or replace function public.claim_device_with_token(
  p_device_id text,
  p_token_hash text,
  p_ctr bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link_token public.device_link_tokens%rowtype;
  target_device public.devices%rowtype;
  token_exists boolean;
  v_pin public.device_pins%rowtype;
  v_previous uuid;
begin
  select * into link_token from public.device_link_tokens where token_hash = p_token_hash for update;
  token_exists := found;
  select * into target_device from public.devices where device_id = p_device_id for update;
  if not found then return jsonb_build_object('linked', false, 'reason', 'wrong_device'); end if;

  if token_exists and link_token.used_at is not null then
    if link_token.used_by_device = p_device_id and target_device.user_id = link_token.user_id then
      return jsonb_build_object('linked', true);
    end if;
    return jsonb_build_object('linked', false, 'reason', 'used');
  end if;

  if p_ctr <= target_device.last_ctr then return jsonb_build_object('linked', false, 'reason', 'replayed'); end if;
  update public.devices set last_ctr = p_ctr, last_seen_at = now() where device_id = p_device_id;

  if not token_exists then return jsonb_build_object('linked', false, 'reason', 'not_found'); end if;
  if link_token.device_id <> p_device_id then return jsonb_build_object('linked', false, 'reason', 'wrong_device'); end if;
  if link_token.expires_at <= now() then return jsonb_build_object('linked', false, 'reason', 'expired'); end if;

  v_previous := target_device.user_id;
  if v_previous is not null and v_previous <> link_token.user_id then
    select * into v_pin from public.device_pins where device_id = p_device_id for update;
    -- Unlocked owned bands are never transferable; locked ones need a token issued after this PIN was verified.
    if not found
      or link_token.transfer_from is distinct from v_previous
      or link_token.pin_verified_at is null
      or link_token.pin_verified_at < v_pin.set_at then
      return jsonb_build_object('linked', false, 'reason', 'already_owned');
    end if;
    if exists (
      select 1 from public.alerts a
      where a.device_id = p_device_id and a.status in ('new', 'acknowledged', 'enroute', 'on_scene')
    ) then
      return jsonb_build_object('linked', false, 'reason', 'active_alert');
    end if;
  end if;

  update public.devices
  set
    user_id = link_token.user_id,
    linked_at = now(),
    unlinked_at = case when v_previous is not null and v_previous <> link_token.user_id then now() else unlinked_at end,
    unlinked_by = case when v_previous is not null and v_previous <> link_token.user_id then link_token.user_id else unlinked_by end,
    device_name = case
      when v_previous is not null and v_previous <> link_token.user_id then coalesce(link_token.nickname, 'Secure Panic Unit')
      when link_token.nickname is not null and device_name = 'Secure Panic Unit' then link_token.nickname
      else device_name
    end
  where device_id = p_device_id;

  -- The band wipes its PIN when it links, so the server copy goes too (also covers same-owner relinks).
  delete from public.device_pins where device_id = p_device_id;

  update public.device_link_tokens
  set used_at = now(), used_by_device = p_device_id
  where id = link_token.id;

  if v_previous is not null and v_previous <> link_token.user_id then
    insert into public.device_security_events (device_id, actor_id, event, detail)
    values (p_device_id, link_token.user_id, 'transferred', jsonb_build_object('from_user', v_previous));
    insert into public.notifications (user_id, type, title, body, href)
    values (
      v_previous, 'system', 'Kiki band transferred',
      'Your band ' || target_device.device_name || ' was moved to another account using its PIN.',
      '/account/devices'
    );
  end if;

  return jsonb_build_object('linked', true);
end;
$$;

revoke execute on function public.claim_device_with_token(text, text, bigint) from public, anon, authenticated;
grant execute on function public.claim_device_with_token(text, text, bigint) to service_role;
