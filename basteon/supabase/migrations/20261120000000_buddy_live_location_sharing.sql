create table public.buddy_location_shares (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  granted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id),
  check ((enabled and granted_at is not null) or not enabled)
);

create index buddy_location_shares_viewer_enabled
  on public.buddy_location_shares (viewer_id, owner_id)
  where enabled;

create table public.buddy_live_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null default now()
);

alter table public.buddy_location_shares enable row level security;
alter table public.buddy_live_locations enable row level security;
revoke all on public.buddy_location_shares, public.buddy_live_locations from public, anon, authenticated;
grant select, insert, update, delete on public.buddy_location_shares, public.buddy_live_locations to service_role;

create or replace function public.cleanup_buddy_location_sharing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_viewer uuid;
begin
  if tg_table_name = 'buddy_contacts' then
    v_owner := old.user_id;
    v_viewer := old.contact_user_id;
  else
    v_owner := new.user_id;
    v_viewer := new.blocked_user_id;
  end if;

  delete from public.buddy_location_shares
  where (owner_id = v_owner and viewer_id = v_viewer)
     or (owner_id = v_viewer and viewer_id = v_owner);

  delete from public.buddy_live_locations l
  where l.user_id in (v_owner, v_viewer)
    and not exists (
      select 1 from public.buddy_location_shares s
      where s.owner_id = l.user_id and s.enabled
    );

  return null;
end;
$$;

create trigger buddy_contacts_cleanup_location_sharing
after delete on public.buddy_contacts
for each row execute function public.cleanup_buddy_location_sharing();

create trigger buddy_blocks_cleanup_location_sharing
after insert on public.buddy_blocks
for each row execute function public.cleanup_buddy_location_sharing();

create or replace function public.clear_buddy_location_when_sharing_disabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.live_location_sharing then
    delete from public.buddy_live_locations where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger user_privacy_clear_buddy_location
after insert or update of live_location_sharing on public.user_privacy_settings
for each row execute function public.clear_buddy_location_when_sharing_disabled();

revoke all on function public.cleanup_buddy_location_sharing(),
  public.clear_buddy_location_when_sharing_disabled() from public, anon, authenticated;
grant execute on function public.cleanup_buddy_location_sharing(),
  public.clear_buddy_location_when_sharing_disabled() to service_role;
