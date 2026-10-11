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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_game not in ('morabaraba', 'linkup') then raise exception 'invalid_game'; end if;
  if p_guest_id is not null and p_guest_id = v_uid then raise exception 'invalid_guest'; end if;

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
      select 1
      from public.linkup_matches match
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
    where host_id = v_uid
      and guest_id = p_guest_id
      and status = 'ready_check'
      and invite_status = 'pending'
      and invite_expires_at > now()
    order by created_at desc
    limit 1;
    if found then return v_room; end if;
  end if;

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
