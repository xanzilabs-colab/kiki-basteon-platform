-- Incremental multiplayer implementation for the pre-existing game room schema.
-- Room snapshots are written only through server-validated actions; chat is participant-scoped.

create table if not exists public.game_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists game_messages_room_time on public.game_messages (room_id, created_at);
alter table public.game_messages enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'game_messages' and policyname = 'game_messages_select_participant'
  ) then
    create policy game_messages_select_participant on public.game_messages
      for select to authenticated using (room_id in (
        select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
      ));
  end if;
end $$;
revoke insert, update, delete on public.game_rooms, public.game_qa, public.game_messages from authenticated;
grant select on public.game_rooms, public.game_qa, public.game_messages to authenticated;

create or replace function public.game_has_mill(p_board jsonb, p_player integer, p_index integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from (values
      (0,1,2),(2,3,4),(4,5,6),(6,7,0),
      (8,9,10),(10,11,12),(12,13,14),(14,15,8),
      (16,17,18),(18,19,20),(20,21,22),(22,23,16),
      (1,9,17),(3,11,19),(5,13,21),(7,15,23)
    ) as mills(a,b,c)
    where p_index in (a,b,c)
      and p_board ->> a = p_player::text
      and p_board ->> b = p_player::text
      and p_board ->> c = p_player::text
  )
$$;

create or replace function public.game_has_legal_move(p_board jsonb, p_player integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with edges(a,b) as (
    values
      (0,1),(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,0),
      (8,9),(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,8),
      (16,17),(17,18),(18,19),(19,20),(20,21),(21,22),(22,23),(23,16),
      (1,9),(9,17),(3,11),(11,19),(5,13),(13,21),(7,15),(15,23)
  ), directed(a,b) as (
    select a,b from edges union all select b,a from edges
  )
  select (
    (
      (select count(*) from generate_series(0,23) i where p_board->>i = p_player::text) = 3
      and exists (select 1 from generate_series(0,23) i where p_board->>i = '0')
    )
    or exists (
      select 1 from directed
      where p_board->>a = p_player::text and p_board->>b = '0'
    )
  )
$$;

create or replace function public.game_create_room(p_guest_id uuid default null)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_guest_id is not null and p_guest_id = v_uid then raise exception 'invalid_guest'; end if;
  insert into public.game_rooms (host_id, guest_id, status, state)
  values (
    v_uid,
    p_guest_id,
    case when p_guest_id is null then 'waiting' else 'ready_check' end,
    jsonb_build_object(
      'board', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
      'turn', 1, 'phase', 'place', 'placed', jsonb_build_object('1',0,'2',0),
      'pendingRemoval', null, 'winner', null
    )
  ) returning * into v_room;
  return v_room;
end $$;

create or replace function public.game_join_room(p_host_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.game_rooms
  set guest_id = v_uid, status = 'playing', starts_at = now(),
      host_ready = true, guest_ready = true, updated_at = now()
  where id = p_host_id and status = 'waiting' and guest_id is null and host_id <> v_uid
  returning * into v_room;
  if v_room.id is null then
    select * into v_room from public.game_rooms
    where id = p_host_id and (host_id = v_uid or guest_id = v_uid) and status <> 'ended';
  end if;
  if v_room.id is null then raise exception 'room_unavailable'; end if;
  return v_room;
end $$;

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
    if v_count <> 3 and not (
      (v_from / 8 = v_to / 8 and ((v_from+1)%8 = v_to or (v_from+7)%8 = v_to))
      or (v_from in (1,9,17) and v_to in (1,9,17) and abs(v_from-v_to)=8)
      or (v_from in (3,11,19) and v_to in (3,11,19) and abs(v_from-v_to)=8)
      or (v_from in (5,13,21) and v_to in (5,13,21) and abs(v_from-v_to)=8)
      or (v_from in (7,15,23) and v_to in (7,15,23) and abs(v_from-v_to)=8)
    ) then raise exception 'not_adjacent'; end if;
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

create or replace function public.game_send_message(p_room_id uuid, p_body text)
returns public.game_messages
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_message public.game_messages;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if length(trim(p_body)) not between 1 and 500 then raise exception 'invalid_message'; end if;
  if not exists (
    select 1 from public.game_rooms where id = p_room_id
      and (host_id = v_uid or guest_id = v_uid) and status <> 'ended'
  ) then raise exception 'room_not_found'; end if;
  insert into public.game_messages (room_id, author_id, body)
  values (p_room_id, v_uid, trim(p_body)) returning * into v_message;
  return v_message;
end $$;

create or replace function public.game_report_room(p_room_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_other uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select case when host_id = v_uid then guest_id else host_id end into v_other
  from public.game_rooms where id = p_room_id and (host_id = v_uid or guest_id = v_uid);
  if v_other is null then raise exception 'room_not_found'; end if;
  insert into public.game_reports (reporter_id, reported_id, reason, note, snapshot)
  values (
    v_uid, v_other, p_reason, p_note,
    jsonb_build_object('room_id', p_room_id, 'qa', (
      select coalesce(jsonb_agg(row_to_json(game_qa)), '[]'::jsonb)
      from public.game_qa where room_id = p_room_id
    ))
  );
end $$;

create or replace function public.game_rematch(p_room_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_room from public.game_rooms where id = p_room_id
    and (host_id = v_uid or guest_id = v_uid) for update;
  if v_room.id is null or v_room.status <> 'post_game' then raise exception 'rematch_unavailable'; end if;
  update public.game_rooms set
    rematch_host = rematch_host or v_uid = host_id,
    rematch_guest = rematch_guest or v_uid = guest_id,
    version = version + 1, updated_at = now()
  where id = p_room_id returning * into v_room;
  if v_room.rematch_host and v_room.rematch_guest then
    update public.game_rooms set
      status = 'playing', round_no = round_no + 1, winner_id = null,
      rematch_host = false, rematch_guest = false,
      state = jsonb_build_object(
        'board', '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
        'turn', 1, 'phase', 'place', 'placed', jsonb_build_object('1',0,'2',0),
        'pendingRemoval', null, 'winner', null
      ), version = version + 1, updated_at = now()
    where id = p_room_id returning * into v_room;
  end if;
  return v_room;
end $$;

revoke all on function public.game_has_mill(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.game_has_legal_move(jsonb, integer) from public, anon, authenticated;
revoke all on function public.game_update_state(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.game_pick_question(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.game_answer_question(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.game_apply_move(uuid, text, integer, integer) from public, anon;
revoke all on function public.game_send_message(uuid, text) from public, anon;
revoke all on function public.game_rematch(uuid) from public, anon;
grant execute on function public.game_apply_move(uuid, text, integer, integer) to authenticated;
grant execute on function public.game_send_message(uuid, text) to authenticated;
grant execute on function public.game_rematch(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_rooms'
  ) then alter publication supabase_realtime add table public.game_rooms; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_messages'
  ) then alter publication supabase_realtime add table public.game_messages; end if;
end $$;
