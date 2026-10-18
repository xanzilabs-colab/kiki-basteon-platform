alter table public.profiles
  add column if not exists kiki_id text;

update public.profiles
set kiki_id = 'KIKI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
where kiki_id is null;

alter table public.profiles
  alter column kiki_id set default ('KIKI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))),
  alter column kiki_id set not null;

create unique index if not exists profiles_kiki_id_unique on public.profiles (kiki_id);

create table public.buddy_connection_requests (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (user_low_id < user_high_id),
  check (requested_by in (user_low_id, user_high_id)),
  unique (user_low_id, user_high_id)
);

create index buddy_connection_requests_incoming
  on public.buddy_connection_requests (user_high_id, status, updated_at desc);
create index buddy_connection_requests_outgoing
  on public.buddy_connection_requests (user_low_id, status, updated_at desc);

alter table public.buddy_connection_requests enable row level security;
revoke all on public.buddy_connection_requests from anon, authenticated;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'buddy_bubble', 'system', 'safety_intel', 'trip_checkpoint',
    'buddy_request', 'buddy_request_accepted', 'game_invite', 'walk_invite',
    'walk_guardian', 'walk_alert'
  ));

create or replace function public.send_buddy_connection_request(
  p_sender uuid,
  p_kiki_id text
) returns table (result text, target_id uuid, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_target uuid;
  v_low uuid;
  v_high uuid;
  v_request public.buddy_connection_requests%rowtype;
begin
  v_code := upper(regexp_replace(trim(coalesce(p_kiki_id, '')), '^KIKI[-_ ]?', ''));
  if v_code !~ '^[0-9A-F]{16}$' then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  select p.id into v_target
  from public.profiles p
  where p.kiki_id = 'KIKI-' || v_code
    and p.role = 'user'
    and p.verification_status <> 'suspended';
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;
  if v_target = p_sender then
    return query select 'self'::text, v_target, null::uuid;
    return;
  end if;

  v_low := least(p_sender, v_target);
  v_high := greatest(p_sender, v_target);
  perform pg_advisory_xact_lock(hashtextextended('buddy_connection:' || v_low::text || ':' || v_high::text, 0));

  if exists (
    select 1 from public.buddy_blocks b
    where (b.user_id = p_sender and b.blocked_user_id = v_target)
       or (b.user_id = v_target and b.blocked_user_id = p_sender)
  ) then
    return query select 'blocked'::text, v_target, null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.buddy_contacts c
    where (c.user_id = p_sender and c.contact_user_id = v_target)
       or (c.user_id = v_target and c.contact_user_id = p_sender)
  ) then
    return query select 'already_connected'::text, v_target, null::uuid;
    return;
  end if;

  select r.* into v_request
  from public.buddy_connection_requests r
  where r.user_low_id = v_low and r.user_high_id = v_high
  for update;

  if found and v_request.status = 'pending' then
    if v_request.requested_by = p_sender then
      return query select 'already_pending'::text, v_target, v_request.id;
    else
      return query select 'incoming_pending'::text, v_target, v_request.id;
    end if;
    return;
  end if;

  if found then
    update public.buddy_connection_requests
    set requested_by = p_sender, status = 'pending', created_at = now(),
        updated_at = now(), responded_at = null
    where id = v_request.id;
  else
    insert into public.buddy_connection_requests (user_low_id, user_high_id, requested_by)
    values (v_low, v_high, p_sender)
    returning * into v_request;
  end if;

  return query select 'request_sent'::text, v_target, v_request.id;
end;
$$;

create or replace function public.respond_buddy_connection_request(
  p_user uuid,
  p_request_id uuid,
  p_accept boolean
) returns table (result text, other_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.buddy_connection_requests%rowtype;
  v_other uuid;
begin
  select r.* into v_request
  from public.buddy_connection_requests r
  where r.id = p_request_id
  for update;
  if not found or v_request.status <> 'pending' then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_request.requested_by = p_user then
    return query select 'not_recipient'::text, null::uuid;
    return;
  end if;
  if p_user <> v_request.user_low_id and p_user <> v_request.user_high_id then
    return query select 'not_recipient'::text, null::uuid;
    return;
  end if;

  v_other := v_request.requested_by;
  perform pg_advisory_xact_lock(
    hashtextextended(
      'buddy_connection:' || v_request.user_low_id::text || ':' || v_request.user_high_id::text,
      0
    )
  );
  if exists (
    select 1 from public.buddy_blocks b
    where (b.user_id = p_user and b.blocked_user_id = v_other)
       or (b.user_id = v_other and b.blocked_user_id = p_user)
  ) then
    update public.buddy_connection_requests
    set status = 'blocked', updated_at = now(), responded_at = now()
    where id = v_request.id;
    return query select 'blocked'::text, v_other;
    return;
  end if;

  if p_accept then
    insert into public.buddy_contacts (user_id, contact_user_id)
    values (p_user, v_other), (v_other, p_user)
    on conflict do nothing;
    update public.buddy_connection_requests
    set status = 'accepted', updated_at = now(), responded_at = now()
    where id = v_request.id;
    return query select 'accepted'::text, v_other;
  else
    update public.buddy_connection_requests
    set status = 'declined', updated_at = now(), responded_at = now()
    where id = v_request.id;
    return query select 'declined'::text, v_other;
  end if;
end;
$$;

create or replace function public.remove_buddy_connection(
  p_user uuid,
  p_other uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_low uuid;
  v_high uuid;
begin
  if p_user = p_other then return 'invalid_target'; end if;
  v_low := least(p_user, p_other);
  v_high := greatest(p_user, p_other);
  perform pg_advisory_xact_lock(hashtextextended('buddy_connection:' || v_low::text || ':' || v_high::text, 0));
  if not exists (
    select 1 from public.buddy_contacts c
    where c.user_id = p_user and c.contact_user_id = p_other
  ) then
    return 'not_connected';
  end if;
  delete from public.buddy_contacts
  where (user_id = p_user and contact_user_id = p_other)
     or (user_id = p_other and contact_user_id = p_user);
  update public.game_rooms
  set status = 'ended', invite_status = 'declined', invite_expires_at = null,
      ended_by = p_user, end_reason = 'declined', updated_at = now()
  where status = 'ready_check' and invite_status = 'pending'
    and ((host_id = p_user and guest_id = p_other) or (host_id = p_other and guest_id = p_user));
  update public.buddy_connection_requests
  set status = 'removed', updated_at = now(), responded_at = now()
  where user_low_id = v_low and user_high_id = v_high;
  return 'removed';
end;
$$;

create or replace function public.block_buddy_connection(
  p_user uuid,
  p_other uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_low uuid;
  v_high uuid;
begin
  if p_user = p_other then return 'invalid_target'; end if;
  if not exists (select 1 from public.profiles where id = p_other and role = 'user') then
    return 'not_found';
  end if;
  v_low := least(p_user, p_other);
  v_high := greatest(p_user, p_other);
  perform pg_advisory_xact_lock(hashtextextended('buddy_connection:' || v_low::text || ':' || v_high::text, 0));
  insert into public.buddy_blocks (user_id, blocked_user_id)
  values (p_user, p_other)
  on conflict do nothing;
  delete from public.buddy_contacts
  where (user_id = p_user and contact_user_id = p_other)
     or (user_id = p_other and contact_user_id = p_user);
  update public.game_rooms
  set status = 'ended', invite_status = 'declined', invite_expires_at = null,
      ended_by = p_user, end_reason = 'declined', updated_at = now()
  where status = 'ready_check' and invite_status = 'pending'
    and ((host_id = p_user and guest_id = p_other) or (host_id = p_other and guest_id = p_user));
  update public.buddy_connection_requests
  set status = 'blocked', updated_at = now(), responded_at = now()
  where user_low_id = v_low and user_high_id = v_high and status <> 'removed';
  return 'blocked';
end;
$$;

create or replace function public.unblock_buddy_connection(
  p_user uuid,
  p_other uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.buddy_blocks
  where user_id = p_user and blocked_user_id = p_other;
  if not found then return 'not_blocked'; end if;
  return 'unblocked';
end;
$$;

revoke all on function public.send_buddy_connection_request(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_buddy_connection_request(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.remove_buddy_connection(uuid, uuid) from public, anon, authenticated;
revoke all on function public.block_buddy_connection(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unblock_buddy_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_buddy_connection_request(uuid, text) to service_role;
grant execute on function public.respond_buddy_connection_request(uuid, uuid, boolean) to service_role;
grant execute on function public.remove_buddy_connection(uuid, uuid) to service_role;
grant execute on function public.block_buddy_connection(uuid, uuid) to service_role;
grant execute on function public.unblock_buddy_connection(uuid, uuid) to service_role;

create or replace function public.game_create_room(
  p_guest_id uuid default null,
  p_game text default 'morabaraba'
)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
  v_is_buddy boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_game not in ('morabaraba', 'linkup', 'teach_one', 'read_room') then raise exception 'invalid_game'; end if;
  if p_guest_id is not null and p_guest_id = v_uid then raise exception 'invalid_guest'; end if;

  if p_guest_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'buddy_connection:' || least(v_uid::text, p_guest_id::text) || ':' || greatest(v_uid::text, p_guest_id::text),
        0
      )
    );
    v_is_buddy := exists (
      select 1 from public.buddy_contacts c
      where c.user_id = v_uid and c.contact_user_id = p_guest_id
    );
  end if;

  update public.game_rooms
  set status = 'ended',
      invite_status = 'expired',
      invite_expires_at = null,
      end_reason = 'timeout',
      updated_at = now()
  where status <> 'ended'
    and invite_status = 'pending'
    and invite_expires_at <= now()
    and (
      host_id = v_uid or guest_id = v_uid
      or (p_guest_id is not null and (host_id = p_guest_id or guest_id = p_guest_id))
    );

  update public.game_rooms room
  set status = 'ended', updated_at = now()
  where room.status <> 'ended'
    and room.game = 'linkup'
    and exists (
      select 1 from public.linkup_matches match
      where match.room_id = room.id and match.status = 'finished'
    )
    and (
      room.host_id = v_uid or room.guest_id = v_uid
      or (p_guest_id is not null and (room.host_id = p_guest_id or room.guest_id = p_guest_id))
    );

  update public.game_rooms
  set status = 'ended', updated_at = now()
  where status = 'post_game'
    and (
      host_id = v_uid or guest_id = v_uid
      or (p_guest_id is not null and (host_id = p_guest_id or guest_id = p_guest_id))
    );

  if p_guest_id is not null then
    select * into v_room
    from public.game_rooms
    where host_id = v_uid and guest_id = p_guest_id and game = p_game
      and status = 'ready_check' and invite_status = 'pending' and invite_expires_at > now()
    order by created_at desc
    limit 1;
    if found then return v_room; end if;
  end if;

  if exists (
    select 1 from public.game_rooms
    where status <> 'ended' and (host_id = v_uid or guest_id = v_uid)
  ) then raise exception 'room_already_open'; end if;

  if p_guest_id is not null then
    if not v_is_buddy and not exists (
      select 1
      from public.game_presence me
      join public.game_presence buddy on buddy.user_id = p_guest_id
      where me.user_id = v_uid and me.status = 'open' and me.expires_at > now()
        and buddy.status = 'open' and buddy.expires_at > now()
        and abs(me.lat - buddy.lat) <= 3.0 / 111.0
        and abs(me.lng - buddy.lng) <= 3.0 / 111.0
    ) then raise exception 'buddy_unavailable'; end if;

    if exists (
      select 1 from public.game_blocks
      where (blocker_id = v_uid and blocked_id = p_guest_id)
         or (blocker_id = p_guest_id and blocked_id = v_uid)
    ) or exists (
      select 1 from public.buddy_blocks
      where (user_id = v_uid and blocked_user_id = p_guest_id)
         or (user_id = p_guest_id and blocked_user_id = v_uid)
    ) then raise exception 'buddy_unavailable'; end if;

    if exists (
      select 1 from public.game_rooms
      where status <> 'ended' and (host_id = p_guest_id or guest_id = p_guest_id)
    ) then raise exception 'buddy_has_open_room'; end if;
  end if;

  begin
    insert into public.game_rooms (game, host_id, guest_id, status, invite_status, invite_expires_at, state)
    values (
      p_game,
      v_uid,
      p_guest_id,
      case when p_guest_id is null then 'waiting' else 'ready_check' end,
      case when p_guest_id is null then 'accepted' else 'pending' end,
      case when p_guest_id is null then null else now() + interval '2 minutes' end,
      case when p_game = 'morabaraba' then jsonb_build_object(
        'board', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
        'turn', 1,
        'phase', 'place',
        'placed', jsonb_build_object('1', 0, '2', 0),
        'pendingRemoval', null,
        'winner', null
      ) else '{}'::jsonb end
    )
    returning * into v_room;
  exception when unique_violation then
    if p_guest_id is not null then raise exception 'buddy_has_open_room'; end if;
    raise exception 'room_already_open';
  end;

  return v_room;
end $$;
revoke all on function public.game_create_room(uuid, text) from public, anon;
grant execute on function public.game_create_room(uuid, text) to authenticated;

create table public.buddy_trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  check (inviter_id <> invited_user_id),
  unique (trip_id, invited_user_id)
);
create index buddy_trip_invitations_incoming
  on public.buddy_trip_invitations (invited_user_id, status, created_at desc);
alter table public.buddy_trip_invitations enable row level security;
revoke all on public.buddy_trip_invitations from anon, authenticated;

create or replace function public.respond_buddy_trip_invitation(
  p_invitation_id uuid,
  p_user uuid,
  p_accept boolean,
  p_meeting_code text
) returns table (result text, bubble_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.buddy_trip_invitations%rowtype;
  v_sender_trip public.buddy_trips%rowtype;
  v_joiner_trip public.buddy_trips%rowtype;
  v_bubble uuid;
  v_expires_at timestamptz;
begin
  select i.* into v_invite
  from public.buddy_trip_invitations i
  where i.id = p_invitation_id and i.invited_user_id = p_user
  for update;
  if not found or v_invite.status <> 'pending' then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_invite.expires_at <= now() then
    update public.buddy_trip_invitations
    set status = 'expired', responded_at = now()
    where id = v_invite.id;
    return query select 'expired'::text, null::uuid;
    return;
  end if;
  if not p_accept then
    update public.buddy_trip_invitations
    set status = 'declined', responded_at = now()
    where id = v_invite.id;
    return query select 'declined'::text, null::uuid;
    return;
  end if;

  select t.* into v_sender_trip
  from public.buddy_trips t
  where t.id = v_invite.trip_id and t.user_id = v_invite.inviter_id
    and t.active and t.expires_at > now()
  for update;
  select t.* into v_joiner_trip
  from public.buddy_trips t
  where t.user_id = p_user and t.active and t.expires_at > now()
  for update;
  if v_sender_trip.id is null then
    update public.buddy_trip_invitations
    set status = 'expired', responded_at = now()
    where id = v_invite.id;
    return query select 'trip_expired'::text, null::uuid;
    return;
  end if;
  if v_joiner_trip.id is null then
    return query select 'needs_trip'::text, null::uuid;
    return;
  end if;
  if not exists (
    select 1 from public.buddy_contacts c
    where c.user_id = p_user and c.contact_user_id = v_invite.inviter_id
  ) or not exists (
    select 1 from public.buddy_contacts c
    where c.user_id = v_invite.inviter_id and c.contact_user_id = p_user
  ) or exists (
    select 1 from public.buddy_blocks b
    where (b.user_id = p_user and b.blocked_user_id = v_invite.inviter_id)
       or (b.user_id = v_invite.inviter_id and b.blocked_user_id = p_user)
  ) then
    update public.buddy_trip_invitations
    set status = 'cancelled', responded_at = now()
    where id = v_invite.id;
    return query select 'not_buddies'::text, null::uuid;
    return;
  end if;

  v_expires_at := least(v_sender_trip.expires_at, v_joiner_trip.expires_at, now() + interval '4 hours');
  select joined_bubble_id into v_bubble
  from public.join_buddy_bubble(
    p_user,
    v_joiner_trip.id,
    v_invite.inviter_id,
    v_sender_trip.id,
    p_meeting_code,
    v_expires_at
  );
  update public.buddy_trip_invitations
  set status = 'accepted', responded_at = now()
  where id = v_invite.id;
  return query select 'accepted'::text, v_bubble;
end;
$$;
revoke all on function public.respond_buddy_trip_invitation(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.respond_buddy_trip_invitation(uuid, uuid, boolean, text) to service_role;

create table public.trip_guardians (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  check (owner_id <> guardian_id),
  unique (trip_id, guardian_id)
);
create index trip_guardians_owner_active on public.trip_guardians (owner_id, trip_id, status);
create index trip_guardians_guardian_active on public.trip_guardians (guardian_id, status, trip_id);
alter table public.trip_guardians enable row level security;
revoke all on public.trip_guardians from anon, authenticated;
