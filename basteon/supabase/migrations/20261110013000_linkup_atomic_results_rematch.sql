create or replace function public.linkup_commit_round(
  p_match_id uuid,
  p_round_id uuid,
  p_round_no integer,
  p_results jsonb,
  p_scores jsonb,
  p_streaks jsonb,
  p_used_words text[],
  p_deadline_at timestamptz,
  p_finished_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.linkup_matches;
  v_round public.linkup_rounds;
  v_result jsonb;
  v_actor_id text;
begin
  select * into v_match
  from public.linkup_matches
  where id = p_match_id
  for update;
  if v_match.id is null then raise exception 'match_not_found'; end if;

  select * into v_round
  from public.linkup_rounds
  where id = p_round_id and match_id = p_match_id
  for update;
  if v_round.id is null or v_round.phase <> 'answer' then return false; end if;

  for v_result in select value from jsonb_array_elements(p_results)
  loop
    v_actor_id := coalesce(v_result->>'userId', v_match.bot_actor_id, 'kiki');
    update public.linkup_answers
    set points = coalesce((v_result->>'points')::integer, 0)
    where round_id = p_round_id and actor_id = v_actor_id;
  end loop;

  update public.linkup_matches
  set scores = p_scores,
      streaks = p_streaks,
      used_words = p_used_words,
      round_no = p_round_no,
      status = case when p_finished_at is null then 'active' else 'finished' end,
      finished_at = p_finished_at
  where id = p_match_id;

  update public.linkup_rounds
  set phase = case when p_finished_at is null then 'result' else 'finished' end,
      phase_started_at = now(),
      deadline_at = p_deadline_at,
      results = p_results
  where id = p_round_id;

  if v_match.room_id is not null then
    update public.game_rooms
    set status = case when p_finished_at is null then 'playing' else 'post_game' end,
        round_no = p_round_no,
        updated_at = now()
    where id = v_match.room_id;
  end if;
  return true;
end $$;

create or replace function public.linkup_rematch(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.linkup_matches;
  v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_match
  from public.linkup_matches
  where id = p_match_id
  for update;
  if v_match.id is null or v_match.room_id is null
     or (v_uid <> v_match.player1_id and v_uid <> v_match.player2_id) then
    raise exception 'match_not_found';
  end if;

  select * into v_room
  from public.game_rooms
  where id = v_match.room_id and game = 'linkup'
  for update;
  if v_room.id is null or v_match.status <> 'finished' or v_room.status <> 'post_game' then
    raise exception 'rematch_unavailable';
  end if;

  update public.game_rooms
  set rematch_host = rematch_host or v_uid = host_id,
      rematch_guest = rematch_guest or v_uid = guest_id,
      updated_at = now()
  where id = v_room.id
  returning * into v_room;

  if not (v_room.rematch_host and v_room.rematch_guest) then
    return jsonb_build_object(
      'started', false,
      'rematch_host', v_room.rematch_host,
      'rematch_guest', v_room.rematch_guest
    );
  end if;

  delete from public.linkup_rounds where match_id = p_match_id;
  delete from public.linkup_turns where match_id = p_match_id;

  update public.linkup_matches
  set status = 'active',
      round_no = 0,
      scores = '{}'::jsonb,
      streaks = '{}'::jsonb,
      used_words = '{}',
      seed = floor(random() * 2147483647)::integer,
      fuse_left_ms = 30000,
      holder_id = null,
      passer_id = null,
      turn_no = 0,
      turn_started_at = null,
      bomb_start = null,
      bomb_end = null,
      bomb_state = '{}'::jsonb,
      finished_at = null
  where id = p_match_id;

  update public.game_rooms
  set status = 'playing',
      round_no = 0,
      winner_id = null,
      rematch_host = false,
      rematch_guest = false,
      updated_at = now()
  where id = v_room.id;

  return jsonb_build_object('started', true, 'rematch_host', false, 'rematch_guest', false);
end $$;

revoke all on function public.linkup_commit_round(uuid, uuid, integer, jsonb, jsonb, jsonb, text[], timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.linkup_commit_round(uuid, uuid, integer, jsonb, jsonb, jsonb, text[], timestamptz, timestamptz)
  to service_role;

revoke all on function public.linkup_rematch(uuid) from public, anon;
grant execute on function public.linkup_rematch(uuid) to authenticated;
