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

    if found then
      return v_room;
    end if;
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
