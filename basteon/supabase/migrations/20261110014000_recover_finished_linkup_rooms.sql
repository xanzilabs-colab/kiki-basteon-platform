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
  set status = 'ended', updated_at = now()
  where status = 'post_game'
    and (
      host_id = v_uid or guest_id = v_uid
      or (p_guest_id is not null and (host_id = p_guest_id or guest_id = p_guest_id))
    );

  insert into public.game_rooms (game, host_id, guest_id, status, state)
  values (
    p_game,
    v_uid,
    p_guest_id,
    case when p_guest_id is null then 'waiting' else 'ready_check' end,
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
  return v_room;
end $$;

revoke all on function public.game_create_room(uuid, text) from public, anon;
grant execute on function public.game_create_room(uuid, text) to authenticated;
