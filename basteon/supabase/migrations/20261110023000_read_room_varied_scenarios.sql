alter table public.read_room_rounds
  drop constraint if exists read_room_rounds_scenario_id_check,
  drop constraint if exists read_room_rounds_p1_emotion_check,
  drop constraint if exists read_room_rounds_p1_response_check,
  drop constraint if exists read_room_rounds_p2_emotion_check,
  drop constraint if exists read_room_rounds_p2_response_check,
  add constraint read_room_rounds_scenario_id_check check (scenario_id between 0 and 11),
  add constraint read_room_rounds_p1_emotion_check check (p1_emotion between 0 and 4),
  add constraint read_room_rounds_p1_response_check check (p1_response between 0 and 4),
  add constraint read_room_rounds_p2_emotion_check check (p2_emotion between 0 and 4),
  add constraint read_room_rounds_p2_response_check check (p2_response between 0 and 4);

create or replace function public.read_room_submit(
  p_session_id uuid,
  p_user uuid,
  p_emotion int,
  p_response int,
  p_bot_emotion int default null,
  p_bot_response int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.read_room_sessions;
  v_round public.read_room_rounds;
begin
  if p_emotion not between 0 and 4 or p_response not between 0 and 4 then
    raise exception 'invalid_choice';
  end if;
  select * into v_session from public.read_room_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'active'
     or (p_user <> v_session.p1 and (v_session.p2 is null or p_user <> v_session.p2)) then
    raise exception 'session_unavailable';
  end if;
  select * into v_round from public.read_room_rounds
  where session_id = p_session_id and round_no = v_session.round_no for update;
  if not found or v_round.phase <> 'answer' then raise exception 'answer_closed'; end if;

  if p_user = v_session.p1 then
    if v_round.p1_emotion is null then
      update public.read_room_rounds set p1_emotion = p_emotion, p1_response = p_response
        where id = v_round.id;
    end if;
  elsif v_session.mode = 'bot' then
    raise exception 'session_unavailable';
  elsif v_round.p2_emotion is null then
    update public.read_room_rounds set p2_emotion = p_emotion, p2_response = p_response
      where id = v_round.id;
  end if;

  if v_session.mode = 'bot' then
    if p_bot_emotion is null or p_bot_emotion not between 0 and 4
       or p_bot_response is null or p_bot_response not between 0 and 4 then
      raise exception 'invalid_bot_choice';
    end if;
    update public.read_room_rounds
       set p2_emotion = p_bot_emotion, p2_response = p_bot_response, phase = 'reveal'
     where id = v_round.id;
  else
    update public.read_room_rounds set phase = 'reveal'
     where id = v_round.id and p1_emotion is not null and p2_emotion is not null;
  end if;
  select phase into v_round.phase from public.read_room_rounds where id = v_round.id;
  return v_round.phase;
end $$;

revoke all on function public.read_room_submit(uuid, uuid, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.read_room_submit(uuid, uuid, int, int, int, int)
  to service_role;
