begin;

create or replace function public.read_room_advance(
  p_session_id uuid,
  p_user uuid,
  p_next_scenario_id int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.read_room_sessions;
  v_round public.read_room_rounds;
begin
  select * into v_session
  from public.read_room_sessions
  where id = p_session_id
  for update;

  if not found
     or (p_user <> v_session.p1 and (v_session.p2 is null or p_user <> v_session.p2)) then
    raise exception 'session_unavailable';
  end if;
  if v_session.status = 'finished' then
    return jsonb_build_object('status', 'finished', 'round_no', v_session.round_no, 'waiting', false);
  end if;
  if v_session.status <> 'active' then raise exception 'session_unavailable'; end if;
  if p_next_scenario_id not between 0 and 11 then raise exception 'invalid_scenario'; end if;

  select * into v_round
  from public.read_room_rounds
  where session_id = p_session_id
    and round_no = v_session.round_no
  for update;
  if not found then raise exception 'reveal_closed'; end if;
  if v_round.phase <> 'reveal' then
    if v_round.phase in ('answer', 'done') then
      return jsonb_build_object('status', 'active', 'round_no', v_session.round_no, 'waiting', false, 'already_advanced', true);
    end if;
    raise exception 'reveal_closed';
  end if;

  update public.read_room_rounds
  set p1_ready = p1_ready or p_user = v_session.p1,
      p2_ready = p2_ready or (v_session.mode = 'bot' or p_user = v_session.p2)
  where id = v_round.id
  returning * into v_round;

  if not v_round.p1_ready or not v_round.p2_ready then
    return jsonb_build_object('status', 'active', 'round_no', v_session.round_no, 'waiting', true);
  end if;

  update public.read_room_rounds set phase = 'done' where id = v_round.id;
  if v_session.round_no >= v_session.rounds_total then
    update public.read_room_sessions
    set status = 'finished', finished_at = now()
    where id = p_session_id;
    if v_session.room_id is not null then
      update public.game_rooms set status = 'post_game', updated_at = now()
      where id = v_session.room_id;
    end if;
    return jsonb_build_object('status', 'finished', 'round_no', v_session.round_no, 'waiting', false);
  end if;

  update public.read_room_sessions
  set round_no = round_no + 1
  where id = p_session_id;
  insert into public.read_room_rounds (session_id, round_no, scenario_id)
  values (p_session_id, v_session.round_no + 1, p_next_scenario_id);
  return jsonb_build_object('status', 'active', 'round_no', v_session.round_no + 1, 'waiting', false);
end;
$$;

revoke all on function public.read_room_advance(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.read_room_advance(uuid, uuid, int)
  to service_role;

commit;
