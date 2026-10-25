create table public.account_security_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_salt text not null,
  pin_hash text not null,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 10),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.account_security_pins enable row level security;
revoke all on public.account_security_pins from public, anon, authenticated;
grant select, insert, update, delete on public.account_security_pins to service_role;

create or replace function public.record_account_pin_failure(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked_until timestamptz;
begin
  update public.account_security_pins
  set failed_attempts = least(failed_attempts + 1, 10)::smallint,
      locked_until = case least(failed_attempts + 1, 10)
        when 5 then pg_catalog.now() + interval '15 minutes'
        when 6 then pg_catalog.now() + interval '30 minutes'
        when 7 then pg_catalog.now() + interval '1 hour'
        when 8 then pg_catalog.now() + interval '4 hours'
        when 9 then pg_catalog.now() + interval '12 hours'
        when 10 then pg_catalog.now() + interval '24 hours'
        else null
      end,
      updated_at = pg_catalog.now()
  where user_id = p_user_id
  returning locked_until into v_locked_until;

  return v_locked_until;
end;
$$;

create or replace function public.reset_account_pin_failures(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.account_security_pins
  set failed_attempts = 0,
      locked_until = null,
      updated_at = pg_catalog.now()
  where user_id = p_user_id;
$$;

revoke all on function public.record_account_pin_failure(uuid) from public, anon, authenticated;
revoke all on function public.reset_account_pin_failures(uuid) from public, anon, authenticated;
grant execute on function public.record_account_pin_failure(uuid) to service_role;
grant execute on function public.reset_account_pin_failures(uuid) to service_role;

drop policy if exists medical_profiles_owner_all on public.medical_profiles;
drop policy if exists medical_profiles_owner_select on public.medical_profiles;
create policy medical_profiles_owner_select on public.medical_profiles
  for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.medical_profiles from anon, authenticated;
grant select on public.medical_profiles to authenticated;

create or replace function public.guard_sensitive_profile_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and (
    new.full_name is distinct from old.full_name
    or new.phone is distinct from old.phone
    or new.home_address is distinct from old.home_address
    or new.emergency_contact_name is distinct from old.emergency_contact_name
    or new.emergency_contact_phone is distinct from old.emergency_contact_phone
  ) then
    raise exception 'sensitive_profile_update_requires_pin' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_sensitive_updates on public.profiles;
create trigger trg_profiles_guard_sensitive_updates
  before update on public.profiles
  for each row execute function public.guard_sensitive_profile_updates();

update public.profiles
set safety_pin_set_at = null
where not exists (
  select 1
  from public.account_security_pins
  where account_security_pins.user_id = profiles.id
);
