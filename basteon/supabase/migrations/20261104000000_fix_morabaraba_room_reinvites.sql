create or replace function public.game_create_room(p_guest_id uuid default null)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_guest_id = v_uid then raise exception 'invalid_target'; end if;

  update public.game_rooms
  set status = 'ended', invite_status = 'expired', invite_expires_at = null,
      end_reason = 'timeout', updated_at = now()
  where status <> 'ended'
    and invite_status = 'pending'
    and invite_expires_at <= now()
    and (
      host_id = v_uid or guest_id = v_uid
      or (p_guest_id is not null and (host_id = p_guest_id or guest_id = p_guest_id))
    );

  update public.game_rooms
  set status = 'ended', updated_at = now()
  where status = 'post_game'
    and (
      host_id = v_uid or guest_id = v_uid
      or (p_guest_id is not null and (host_id = p_guest_id or guest_id = p_guest_id))
    );

  if exists (
    select 1 from public.game_rooms
    where status <> 'ended' and (host_id = v_uid or guest_id = v_uid)
  ) then
    raise exception 'room_already_open';
  end if;

  if p_guest_id is not null then
    if not exists (
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
    ) then raise exception 'buddy_unavailable'; end if;

    if exists (
      select 1 from public.game_rooms
      where status <> 'ended' and (host_id = p_guest_id or guest_id = p_guest_id)
    ) then raise exception 'buddy_has_open_room'; end if;
  end if;

  begin
    insert into public.game_rooms (host_id, guest_id, status, invite_status, invite_expires_at)
    values (
      v_uid,
      p_guest_id,
      case when p_guest_id is null then 'waiting' else 'ready_check' end,
      case when p_guest_id is null then 'accepted' else 'pending' end,
      case when p_guest_id is null then null else now() + interval '2 minutes' end
    )
    returning * into v_room;
  exception when unique_violation then
    if p_guest_id is not null then raise exception 'buddy_has_open_room'; end if;
    raise exception 'room_already_open';
  end;

  return v_room;
end
$$;

create or replace function public.game_respond_invite(p_room_id uuid, p_accept boolean)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_room
  from public.game_rooms
  where id = p_room_id and guest_id = v_uid
    and invite_status = 'pending' and status = 'ready_check'
  for update;
  if not found then raise exception 'invite_unavailable'; end if;

  if v_room.invite_expires_at is null or v_room.invite_expires_at <= now() then
    update public.game_rooms
    set status = 'ended', invite_status = 'expired', invite_expires_at = null,
        end_reason = 'timeout', updated_at = now()
    where id = p_room_id
    returning * into v_room;
    return v_room;
  end if;

  if p_accept then
    update public.game_rooms
    set invite_status = 'accepted', invite_expires_at = null, status = 'playing',
        host_ready = true, guest_ready = true, starts_at = coalesce(starts_at, now()),
        updated_at = now()
    where id = p_room_id
    returning * into v_room;
  else
    update public.game_rooms
    set invite_status = 'declined', invite_expires_at = null, status = 'ended',
        ended_by = v_uid, end_reason = 'declined', updated_at = now()
    where id = p_room_id
    returning * into v_room;
  end if;

  return v_room;
end
$$;

create or replace function public.game_join_room(p_host_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  update public.game_rooms
  set guest_id = v_uid, status = 'playing', invite_status = 'accepted',
      host_ready = true, guest_ready = true, starts_at = coalesce(starts_at, now()),
      updated_at = now()
  where id = p_host_id and host_id <> v_uid
    and status = 'waiting' and guest_id is null
  returning * into v_room;

  if found then return v_room; end if;

  select * into v_room
  from public.game_rooms
  where id = p_host_id
    and (host_id = v_uid or (guest_id = v_uid and invite_status = 'accepted'))
  for update;

  if not found or v_room.status in ('ended', 'paused') then
    raise exception 'room_unavailable';
  end if;

  if v_room.status = 'ready_check' and v_room.invite_status = 'accepted' then
    update public.game_rooms
    set status = 'playing', host_ready = true, guest_ready = true,
        starts_at = coalesce(starts_at, now()), updated_at = now()
    where id = p_host_id
    returning * into v_room;
  end if;

  return v_room;
end
$$;

revoke all on function public.game_create_room(uuid) from public, anon;
revoke all on function public.game_respond_invite(uuid, boolean) from public, anon;
revoke all on function public.game_join_room(uuid) from public, anon;
grant execute on function public.game_create_room(uuid) to authenticated;
grant execute on function public.game_respond_invite(uuid, boolean) to authenticated;
grant execute on function public.game_join_room(uuid) to authenticated;
