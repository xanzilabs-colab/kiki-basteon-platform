-- Kiki Games core: multiplayer Morabaraba room state, coarse map presence, and Q&A.
-- This is the required server-side backbone for room state, pair matching, and live game flow.

create or replace function public.game_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.game_questions (
  id uuid primary key default gen_random_uuid(),
  theme text not null check (theme in ('everyday','taste','joy','dreams','courage','people','home')),
  depth smallint not null check (depth between 1 and 4),
  text text not null check (length(text) between 10 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index game_questions_theme_depth
  on public.game_questions (theme, depth)
  where active;

create table public.game_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat numeric(5,2) not null check (lat between -90 and 90),
  lng numeric(5,2) not null check (lng between -180 and 180),
  status text not null default 'open' check (status in ('open','in_game')),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_nearby_at timestamptz,
  updated_at timestamptz not null default now()
);
create index game_presence_expiry on public.game_presence (expires_at);
create index game_presence_geo on public.game_presence (lat, lng);

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'morabaraba' check (game = 'morabaraba'),
  host_id uuid not null references auth.users(id) on delete cascade,
  guest_id uuid references auth.users(id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting','ready_check','playing','paused','post_game','ended')),
  host_ready boolean not null default false,
  guest_ready boolean not null default false,
  round_no integer not null default 1,
  state jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  starts_at timestamptz,
  winner_id uuid,
  host_wins integer not null default 0,
  guest_wins integer not null default 0,
  paused_by uuid,
  paused_at timestamptz,
  rematch_host boolean not null default false,
  rematch_guest boolean not null default false,
  ended_by uuid,
  end_reason text check (end_reason in ('left','timeout','declined')),
  host_ack boolean not null default false,
  guest_ack boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_room_distinct check (guest_id is null or guest_id <> host_id)
);
create unique index game_one_active_room_per_host
  on public.game_rooms (host_id)
  where status <> 'ended';
create unique index game_one_active_room_per_guest
  on public.game_rooms (guest_id)
  where status <> 'ended' and guest_id is not null;
create index game_rooms_status on public.game_rooms (status);

create table public.game_seen (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table public.game_qa (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  round_no integer not null,
  asker_id uuid not null,
  answerer_id uuid not null,
  options uuid[] not null,
  picked_question_id uuid references public.game_questions(id),
  state text not null default 'picking'
    check (state in ('picking','asked','answered','passed','skipped','back_asked','done')),
  answer text check (answer is null or length(answer) between 1 and 400),
  answer_back text check (answer_back is null or length(answer_back) between 1 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, round_no)
);

create table public.game_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.game_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('harassment','inappropriate','spam','other')),
  note text check (note is null or length(note) <= 500),
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create trigger game_rooms_touch before update on public.game_rooms
  for each row execute function public.game_touch_updated_at();
create trigger game_qa_touch before update on public.game_qa
  for each row execute function public.game_touch_updated_at();

alter table public.game_questions enable row level security;
alter table public.game_presence enable row level security;
alter table public.game_rooms enable row level security;
alter table public.game_seen enable row level security;
alter table public.game_qa enable row level security;
alter table public.game_blocks enable row level security;
alter table public.game_reports enable row level security;

create policy game_questions_select_public on public.game_questions
  for select to authenticated using (true);

create policy game_presence_select_own on public.game_presence
  for select to authenticated using (user_id = auth.uid());
create policy game_presence_upsert_own on public.game_presence
  for insert to authenticated with check (user_id = auth.uid());
create policy game_presence_update_own on public.game_presence
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy game_rooms_select_participant on public.game_rooms
  for select to authenticated using (host_id = auth.uid() or guest_id = auth.uid());
create policy game_rooms_insert_own on public.game_rooms
  for insert to authenticated with check (host_id = auth.uid());
create policy game_rooms_update_participant on public.game_rooms
  for update to authenticated using (host_id = auth.uid() or guest_id = auth.uid())
  with check (host_id = auth.uid() or guest_id = auth.uid());

create policy game_qa_select_participant on public.game_qa
  for select to authenticated using (room_id in (
    select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
  ));
create policy game_qa_update_participant on public.game_qa
  for update to authenticated using (room_id in (
    select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
  ))
  with check (room_id in (
    select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
  ));

create policy game_seen_select_participant on public.game_seen
  for select to authenticated using (room_id in (
    select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
  ));
create policy game_seen_insert_own on public.game_seen
  for insert to authenticated with check (
    room_id in (
      select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
    ) and user_id = auth.uid()
  );

create policy game_blocks_select_own on public.game_blocks
  for select to authenticated using (blocker_id = auth.uid() or blocked_id = auth.uid());
create policy game_blocks_insert_own on public.game_blocks
  for insert to authenticated with check (blocker_id = auth.uid());

create policy game_reports_insert_own on public.game_reports
  for insert to authenticated with check (reporter_id = auth.uid());

create or replace function public.game_set_presence(p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.game_presence (user_id, lat, lng, status, expires_at)
  values (v_uid, round(p_lat, 2), round(p_lng, 2), 'open', now() + interval '3 minutes')
  on conflict (user_id)
  do update set
    lat = round(excluded.lat, 2),
    lng = round(excluded.lng, 2),
    status = 'open',
    expires_at = now() + interval '3 minutes',
    updated_at = now();
end $$;

create or replace function public.game_clear_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.game_presence where user_id = v_uid;
end $$;

create or replace function public.game_nearby(p_lat numeric, p_lng numeric, p_radius_km numeric default 1)
returns table (
  user_id uuid,
  lat numeric,
  lng numeric,
  status text,
  opened_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select gp.user_id, gp.lat, gp.lng, gp.status, gp.opened_at, gp.expires_at
  from public.game_presence gp
  where gp.user_id <> auth.uid()
    and gp.status = 'open'
    and gp.expires_at > now()
    and abs(gp.lat - p_lat) <= p_radius_km / 111.0
    and abs(gp.lng - p_lng) <= p_radius_km / 111.0;
$$;

create or replace function public.game_create_room(p_guest_id uuid default null)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.game_rooms; begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if exists (
    select 1 from public.game_rooms
    where status <> 'ended' and host_id = v_uid
  ) then
    raise exception 'room_already_open';
  end if;

  insert into public.game_rooms (host_id, guest_id, status)
  values (v_uid, p_guest_id, case when p_guest_id is not null then 'ready_check' else 'waiting' end)
  returning * into v_room;

  return v_room;
end $$;

create or replace function public.game_join_room(p_host_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_room public.game_rooms; begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.game_rooms
  set guest_id = v_uid,
      status = 'ready_check',
      updated_at = now()
  where id in (
    select id from public.game_rooms where host_id = p_host_id and status = 'waiting' and guest_id is null
  )
  returning * into v_room;

  if v_room.id is null then
    raise exception 'room_unavailable';
  end if;

  return v_room;
end $$;

create or replace function public.game_set_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_row public.game_rooms; begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
  from public.game_rooms
  where id = p_room_id and (host_id = v_uid or guest_id = v_uid);

  if v_row.id is null then
    raise exception 'room_not_found';
  end if;

  if v_row.host_id = v_uid then
    update public.game_rooms set host_ready = p_ready, status = case when p_ready and guest_ready then 'playing' else 'ready_check' end, updated_at = now() where id = p_room_id;
  else
    update public.game_rooms set guest_ready = p_ready, status = case when host_ready and p_ready then 'playing' else 'ready_check' end, updated_at = now() where id = p_room_id;
  end if;
end $$;

create or replace function public.game_heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.game_seen (room_id, user_id, seen_at)
  values (p_room_id, v_uid, now())
  on conflict (room_id, user_id)
  do update set seen_at = now();
end $$;

create or replace function public.game_update_state(p_room_id uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.game_rooms
  set state = p_state,
      version = version + 1,
      updated_at = now()
  where id = p_room_id and (host_id = v_uid or guest_id = v_uid);

  if not found then
    raise exception 'room_not_found';
  end if;
end $$;

create or replace function public.game_pick_question(p_room_id uuid, p_round_no integer, p_question_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.game_qa (room_id, round_no, asker_id, answerer_id, options, picked_question_id, state)
  values (
    p_room_id,
    p_round_no,
    v_uid,
    (select case when host_id = v_uid then guest_id else host_id end from public.game_rooms where id = p_room_id),
    array[]::uuid[],
    p_question_id,
    'asked'
  )
  on conflict (room_id, round_no)
  do update set picked_question_id = excluded.picked_question_id,
               state = 'asked',
               updated_at = now();
end $$;

create or replace function public.game_answer_question(p_room_id uuid, p_round_no integer, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.game_qa
  set answer = p_answer,
      state = 'answered',
      updated_at = now()
  where room_id = p_room_id and round_no = p_round_no and answerer_id = v_uid;

  if not found then
    raise exception 'question_not_found';
  end if;
end $$;

create or replace function public.game_leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.game_rooms
  set status = 'ended',
      ended_by = v_uid,
      end_reason = 'left',
      updated_at = now()
  where id = p_room_id and (host_id = v_uid or guest_id = v_uid);

  if not found then
    raise exception 'room_not_found';
  end if;
end $$;

create or replace function public.game_report_room(p_room_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.game_reports (reporter_id, reported_id, reason, note, snapshot)
  values (
    v_uid,
    (select case when host_id = v_uid then guest_id else host_id end from public.game_rooms where id = p_room_id),
    p_reason,
    p_note,
    jsonb_build_object(
      'room_id', p_room_id,
      'qa', (
        select coalesce(jsonb_agg(row_to_json(game_qa)), '[]'::jsonb)
        from public.game_qa where room_id = p_room_id
      )
    )
  );
end $$;

do $$
declare r record; begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'game\_%'
      and p.proname <> 'game_touch_updated_at'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

create table public.game_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index game_messages_room_time on public.game_messages (room_id, created_at);
alter table public.game_messages enable row level security;
create policy game_messages_select_participant on public.game_messages
  for select to authenticated using (room_id in (
    select id from public.game_rooms where host_id = auth.uid() or guest_id = auth.uid()
  ));
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
      'turn', 1,
      'phase', 'place',
      'placed', jsonb_build_object('1', 0, '2', 0),
      'pendingRemoval', null,
      'winner', null
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
    where id = p_host_id and (host_id = v_uid or guest_id = v_uid);
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
      and exists (select 1 from generate_series(0,23) i where v_board->>i = v_opponent::text and not public.game_has_mill(v_board, v_opponent, i))
    then raise exception 'cannot_remove_mill'; end if;
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
      v_turn := v_opponent;
      v_state := jsonb_set(v_state, '{turn}', to_jsonb(v_turn));
    end if;
  end if;

  v_state := jsonb_set(v_state, '{board}', v_board);
  if v_state->'pendingRemoval' = 'null'::jsonb and v_state->>'phase' = 'move' then
    v_turn := (v_state->>'turn')::integer;
    select count(*) into v_count from generate_series(0,23) i where v_board->>i = v_turn::text;
    if v_count <= 2 or not public.game_has_legal_move(v_board, v_turn) then
      v_winner := v_uid;
    end if;
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
  if not exists (select 1 from public.game_rooms where id = p_room_id and (host_id = v_uid or guest_id = v_uid)) then
    raise exception 'room_not_found';
  end if;
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
