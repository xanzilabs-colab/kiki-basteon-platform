alter table public.game_rooms
  drop constraint if exists game_rooms_game_check;

alter table public.game_rooms
  add constraint game_rooms_game_check
  check (game in ('morabaraba', 'linkup'));

drop function if exists public.game_create_room(uuid);

create function public.game_create_room(
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

create table public.linkup_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique references public.game_rooms(id) on delete cascade,
  mode text not null default 'classic'
    check (mode in ('classic','minefield','chain','wildcard','bomb')),
  vs_bot boolean not null default false,
  bot_difficulty text check (bot_difficulty is null or bot_difficulty in ('easy','medium','hard')),
  player1_id uuid not null references auth.users(id) on delete cascade,
  player2_id uuid references auth.users(id) on delete cascade,
  bot_actor_id text,
  status text not null default 'lobby'
    check (status in ('lobby','active','finished','abandoned')),
  round_no integer not null default 0,
  scores jsonb not null default '{}'::jsonb,
  streaks jsonb not null default '{}'::jsonb,
  used_words text[] not null default '{}',
  seed integer not null,
  fuse_left_ms integer not null default 30000 check (fuse_left_ms >= 0),
  holder_id uuid references auth.users(id),
  passer_id uuid references auth.users(id),
  turn_no integer not null default 0,
  turn_started_at timestamptz,
  bomb_start text,
  bomb_end text,
  bomb_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint linkup_matches_players_distinct check (player2_id is null or player1_id <> player2_id),
  constraint linkup_matches_bot_difficulty check (not vs_bot or bot_difficulty is not null)
);
create index linkup_matches_players_status
  on public.linkup_matches (player1_id, player2_id, status);

create table public.linkup_rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.linkup_matches(id) on delete cascade,
  round_no integer not null,
  spec jsonb not null,
  phase text not null
    check (phase in ('countdown','pick','reveal','answer','result','finished')),
  phase_started_at timestamptz not null default now(),
  deadline_at timestamptz,
  picks jsonb not null default '{}'::jsonb,
  locked_user_ids uuid[] not null default '{}',
  bot_answer jsonb,
  results jsonb,
  chain_broken boolean not null default false,
  sudden_death boolean not null default false,
  unique (match_id, round_no)
);

create table public.linkup_answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.linkup_rounds(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  actor_id text not null,
  raw_text text not null default '',
  alternatives jsonb not null default '[]'::jsonb,
  word text not null default '',
  valid boolean not null default false,
  reason text not null default 'timeout',
  answer_ms integer,
  points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (round_id, actor_id)
);

alter table public.linkup_answers replica identity full;

create table public.linkup_turns (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.linkup_matches(id) on delete cascade,
  turn_no integer not null,
  holder_id uuid references auth.users(id) on delete cascade,
  actor_id text not null,
  start text not null,
  "end" text not null,
  word text not null default '',
  valid boolean not null default false,
  reason text not null default 'timeout',
  used_ms integer not null default 0 check (used_ms >= 0),
  fuse_after_ms integer not null default 0 check (fuse_after_ms >= 0),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id, turn_no)
);

create table public.linkup_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'classic'
    check (mode in ('classic','minefield','chain','wildcard','bomb')),
  updated_at timestamptz not null default now()
);

alter table public.linkup_matches enable row level security;
alter table public.linkup_rounds enable row level security;
alter table public.linkup_answers enable row level security;
alter table public.linkup_turns enable row level security;
alter table public.linkup_preferences enable row level security;

create policy linkup_matches_select_player on public.linkup_matches
  for select to authenticated
  using (player1_id = auth.uid() or player2_id = auth.uid());
create policy linkup_rounds_select_player on public.linkup_rounds
  for select to authenticated using (
    exists (
      select 1 from public.linkup_matches m
      where m.id = match_id and (m.player1_id = auth.uid() or m.player2_id = auth.uid())
    )
  );
create policy linkup_answers_select_hidden on public.linkup_answers
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.linkup_rounds r
      join public.linkup_matches m on m.id = r.match_id
      where r.id = round_id and r.phase in ('result','finished')
        and (m.player1_id = auth.uid() or m.player2_id = auth.uid())
    )
  );
create policy linkup_turns_select_hidden on public.linkup_turns
  for select to authenticated using (
    holder_id = auth.uid()
    or (resolved and exists (
      select 1 from public.linkup_matches m
      where m.id = match_id and (m.player1_id = auth.uid() or m.player2_id = auth.uid())
    ))
  );
create policy linkup_preferences_select_own on public.linkup_preferences
  for select to authenticated using (user_id = auth.uid());
create policy linkup_preferences_insert_own on public.linkup_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy linkup_preferences_update_own on public.linkup_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.linkup_matches from anon, authenticated;
revoke insert, update, delete on public.linkup_rounds from anon, authenticated;
revoke insert, update, delete on public.linkup_answers from anon, authenticated;
revoke insert, update, delete on public.linkup_turns from anon, authenticated;
revoke select on public.linkup_matches from anon, authenticated;
revoke select on public.linkup_rounds from anon, authenticated;
grant select (
  id, room_id, mode, vs_bot, bot_difficulty, player1_id, player2_id,
  status, round_no, scores, streaks, used_words, seed, fuse_left_ms,
  holder_id, passer_id, turn_no, turn_started_at, bomb_start, bomb_end,
  created_at, finished_at
) on public.linkup_matches to authenticated;
create view public.linkup_rounds_public
with (security_barrier = true)
as
select
  r.id,
  r.match_id,
  r.round_no,
  r.spec,
  r.phase,
  r.phase_started_at,
  r.deadline_at,
  case when r.phase = 'pick'
    then jsonb_strip_nulls(jsonb_build_object('carryStart', r.picks->'carryStart'))
    else r.picks
  end as picks,
  r.locked_user_ids,
  r.results,
  r.chain_broken,
  r.sudden_death
from public.linkup_rounds r
where exists (
  select 1 from public.linkup_matches m
  where m.id = r.match_id and (m.player1_id = auth.uid() or m.player2_id = auth.uid())
);
grant select on public.linkup_rounds_public to authenticated;

create or replace function public.linkup_set_mode(p_room_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('classic','minefield','chain','wildcard','bomb') then raise exception 'invalid_mode'; end if;
  select * into v_room from public.game_rooms
    where id = p_room_id and game = 'linkup' and (host_id = v_uid or guest_id = v_uid)
    for update;
  if v_room.id is null then raise exception 'room_not_found'; end if;
  if v_room.host_id <> v_uid then raise exception 'host_only'; end if;
  if v_room.host_ready or v_room.guest_ready then raise exception 'mode_locked'; end if;
  update public.game_rooms
    set state = jsonb_set(coalesce(state, '{}'::jsonb), '{linkupMode}', to_jsonb(p_mode), true)
    where id = p_room_id;
  insert into public.linkup_preferences (user_id, mode)
    values (v_uid, p_mode)
    on conflict (user_id) do update set mode = excluded.mode, updated_at = now();
end $$;

create or replace function public.linkup_set_ready(p_room_id uuid, p_ready boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.game_rooms;
  v_mode text;
  v_match_id uuid;
  v_host_ready boolean;
  v_guest_ready boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_room from public.game_rooms
    where id = p_room_id and game = 'linkup' and (host_id = v_uid or guest_id = v_uid)
    for update;
  if v_room.id is null then raise exception 'room_not_found'; end if;
  if v_room.guest_id is null then raise exception 'waiting_for_buddy'; end if;
  if v_room.status = 'playing' then
    if p_ready then
      select id into v_match_id from public.linkup_matches where room_id = p_room_id;
      if v_match_id is not null then return v_match_id; end if;
    end if;
    raise exception 'match_started';
  end if;
  if v_room.status <> 'ready_check' then raise exception 'room_not_ready'; end if;

  v_mode := coalesce(v_room.state->>'linkupMode', 'classic');
  v_host_ready := case when v_uid = v_room.host_id then p_ready else v_room.host_ready end;
  v_guest_ready := case when v_uid = v_room.guest_id then p_ready else v_room.guest_ready end;
  update public.game_rooms set
    host_ready = v_host_ready,
    guest_ready = v_guest_ready,
    status = case when v_host_ready and v_guest_ready then 'playing' else 'ready_check' end,
    updated_at = now()
  where id = p_room_id;

  if v_host_ready and v_guest_ready then
    insert into public.linkup_matches (room_id, mode, player1_id, player2_id, status, seed)
      values (p_room_id, v_mode, v_room.host_id, v_room.guest_id, 'active', floor(random() * 2147483647)::integer)
      on conflict (room_id) do update set mode = excluded.mode
      returning id into v_match_id;
  end if;
  return v_match_id;
end $$;

create or replace function public.linkup_create_bot_match(p_mode text, p_difficulty text)
returns public.linkup_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.linkup_matches;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('classic','minefield','chain','wildcard','bomb') then raise exception 'invalid_mode'; end if;
  if p_difficulty not in ('easy','medium','hard') then raise exception 'invalid_difficulty'; end if;
  insert into public.linkup_matches (mode, vs_bot, bot_difficulty, player1_id, bot_actor_id, status, seed)
    values (p_mode, true, p_difficulty, v_uid, 'kiki', 'active', floor(random() * 2147483647)::integer)
    returning * into v_match;
  insert into public.linkup_preferences (user_id, mode)
    values (v_uid, p_mode)
    on conflict (user_id) do update set mode = excluded.mode, updated_at = now();
  return v_match;
end $$;

revoke all on function public.linkup_set_mode(uuid, text) from public, anon;
revoke all on function public.linkup_set_ready(uuid, boolean) from public, anon;
revoke all on function public.linkup_create_bot_match(text, text) from public, anon;
grant execute on function public.linkup_set_mode(uuid, text) to authenticated;
grant execute on function public.linkup_set_ready(uuid, boolean) to authenticated;
grant execute on function public.linkup_create_bot_match(text, text) to authenticated;
