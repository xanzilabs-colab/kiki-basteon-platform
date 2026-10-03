alter table public.profiles
  add column if not exists home_address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists consented_at timestamptz;

alter table public.devices
  add column if not exists linked_at timestamptz,
  add column if not exists unlinked_at timestamptz,
  add column if not exists unlinked_by uuid references public.profiles(id) on delete set null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, consented_at, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'consent' = 'true' then now() else null end,
    'user'
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.profiles_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.id is distinct from old.id then
    raise exception 'profile id cannot be changed';
  end if;
  if auth.uid() is not null and not public.is_admin() and new.role is distinct from old.role then
    raise exception 'profile role cannot be changed';
  end if;
  if auth.uid() is not null and not public.is_admin() and (
    new.created_at is distinct from old.created_at
    or new.consented_at is distinct from old.consented_at
  ) then
    raise exception 'privileged profile fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_before_update on public.profiles;
create trigger trg_profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.app_role());

create table if not exists public.device_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  token_hash text not null,
  nickname text,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device text references public.devices(device_id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists device_link_tokens_hash_idx on public.device_link_tokens (token_hash);
create index if not exists device_link_tokens_user_created_idx on public.device_link_tokens (user_id, created_at desc);

alter table public.device_link_tokens enable row level security;
revoke all on public.device_link_tokens from anon, authenticated;

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
  if target_device.user_id is not null and target_device.user_id <> link_token.user_id then
    return jsonb_build_object('linked', false, 'reason', 'already_owned');
  end if;

  update public.devices
  set
    user_id = link_token.user_id,
    linked_at = now(),
    device_name = case
      when link_token.nickname is not null and device_name = 'Secure Panic Unit' then link_token.nickname
      else device_name
    end
  where device_id = p_device_id;

  update public.device_link_tokens
  set used_at = now(), used_by_device = p_device_id
  where id = link_token.id;

  return jsonb_build_object('linked', true);
end;
$$;

revoke execute on function public.claim_device_with_token(text, text, bigint) from public, anon, authenticated;
grant execute on function public.claim_device_with_token(text, text, bigint) to service_role;

-- Expired unused token rows can be deleted periodically by a service-role maintenance job.