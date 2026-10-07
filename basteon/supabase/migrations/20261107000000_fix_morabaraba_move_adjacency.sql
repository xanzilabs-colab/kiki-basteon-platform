create or replace function public.game_apply_move(
  p_room_id uuid,
  p_action text,
  p_from integer default null,
  p_to integer default null
)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
  v_state jsonb;
  v_board jsonb;
  v_placed jsonb;
  v_player integer;
  v_opponent integer;
  v_turn integer;
  v_phase text;
  v_pending integer;
  v_from integer;
  v_to integer;
  v_count integer;
  v_made_mill boolean := false;
  v_winner uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_action not in ('place','move','remove') then raise exception 'invalid_action'; end if;
  select * into v_room from public.game_rooms
  where id = p_room_id and (host_id = v_uid or guest_id = v_uid)
  for update;
  if v_room.id is null then raise exception 'room_not_found'; end if;
  if v_room.status <> 'playing' then raise exception 'game_not_playing'; end if;
  v_player := case when v_uid = v_room.host_id then 1 else 2 end;
  v_opponent := case when v_player = 1 then 2 else 1 end;
  v_state := v_room.state;
  v_board := v_state->'board';
  v_placed := v_state->'placed';
  v_turn := (v_state->>'turn')::integer;
  v_phase := v_state->>'phase';
  v_pending := nullif(v_state->>'pendingRemoval', '')::integer;
  if jsonb_typeof(v_board) <> 'array' or jsonb_array_length(v_board) <> 24 then
    raise exception 'invalid_game_state';
  end if;
  if v_player <> v_turn then raise exception 'not_your_turn'; end if;

  if p_action = 'remove' then
    if v_pending is distinct from v_player then raise exception 'removal_not_pending'; end if;
    v_to := p_to;
    if v_to is null or v_to < 0 or v_to > 23 or v_board->>v_to <> v_opponent::text then
      raise exception 'invalid_removal';
    end if;
    if public.game_has_mill(v_board, v_opponent, v_to)
      and exists (
        select 1 from generate_series(0,23) i
        where v_board->>i = v_opponent::text and not public.game_has_mill(v_board, v_opponent, i)
      ) then raise exception 'cannot_remove_mill'; end if;
    v_board := jsonb_set(v_board, array[v_to::text], '0'::jsonb);
    v_state := jsonb_set(v_state, '{pendingRemoval}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_opponent));
  elsif p_action = 'place' then
    v_to := p_to;
    if v_pending is not null or v_phase <> 'place' or v_to is null or v_to < 0 or v_to > 23
      or v_board->>v_to <> '0' then raise exception 'invalid_placement'; end if;
    if (v_placed->>v_player::text)::integer >= 12 then raise exception 'all_cows_placed'; end if;
    v_board := jsonb_set(v_board, array[v_to::text], to_jsonb(v_player));
    v_placed := jsonb_set(v_placed, array[v_player::text], to_jsonb((v_placed->>v_player::text)::integer + 1));
    v_made_mill := public.game_has_mill(v_board, v_player, v_to);
    if v_made_mill then
      v_state := jsonb_set(v_state, '{pendingRemoval}', to_jsonb(v_player));
    else
      v_turn := v_opponent;
    end if;
    if (v_placed->>'1')::integer = 12 and (v_placed->>'2')::integer = 12 then
      v_state := jsonb_set(v_state, '{phase}', '"move"'::jsonb);
    end if;
    v_state := jsonb_set(v_state, '{placed}', v_placed);
    v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_turn));
  else
    v_from := p_from;
    v_to := p_to;
    if v_pending is not null or v_phase <> 'move' or v_from is null or v_to is null
      or v_from < 0 or v_from > 23 or v_to < 0 or v_to > 23
      or v_board->>v_from <> v_player::text or v_board->>v_to <> '0' then
      raise exception 'invalid_move';
    end if;
    select count(*) into v_count from generate_series(0,23) i where v_board->>i = v_player::text;
    if v_count <> 3 and not exists (
      select 1
      from (values
        (0,1),(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,0),
        (8,9),(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,8),
        (16,17),(17,18),(18,19),(19,20),(20,21),(21,22),(22,23),(23,16),
        (1,9),(9,17),(3,11),(11,19),(5,13),(13,21),(7,15),(15,23)
      ) as edges(a,b)
      where (a = v_from and b = v_to) or (a = v_to and b = v_from)
    ) then
      raise exception 'not_adjacent';
    end if;
    v_board := jsonb_set(jsonb_set(v_board, array[v_from::text], '0'::jsonb), array[v_to::text], to_jsonb(v_player));
    v_made_mill := public.game_has_mill(v_board, v_player, v_to);
    if v_made_mill then
      v_state := jsonb_set(v_state, '{pendingRemoval}', to_jsonb(v_player));
    else
      v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_opponent));
    end if;
  end if;

  v_state := jsonb_set(v_state, '{board}', v_board);
  if v_state->'pendingRemoval' = 'null'::jsonb and v_state->>'phase' = 'move' then
    v_turn := (v_state->>'turn')::integer;
    select count(*) into v_count from generate_series(0,23) i where v_board->>i = v_turn::text;
    if v_count <= 2 or not public.game_has_legal_move(v_board, v_turn) then v_winner := v_uid; end if;
  end if;
  if v_winner is not null then
    v_state := jsonb_set(v_state, '{winner}', to_jsonb(case when v_winner = v_room.host_id then 1 else 2 end));
    update public.game_rooms set state = v_state, status = 'post_game', winner_id = v_winner,
      host_wins = host_wins + case when v_winner = host_id then 1 else 0 end,
      guest_wins = guest_wins + case when v_winner = guest_id then 1 else 0 end,
      version = version + 1, updated_at = now()
    where id = p_room_id returning * into v_room;
  else
    update public.game_rooms set state = v_state, version = version + 1, updated_at = now()
    where id = p_room_id returning * into v_room;
  end if;
  return v_room;
end $$;
