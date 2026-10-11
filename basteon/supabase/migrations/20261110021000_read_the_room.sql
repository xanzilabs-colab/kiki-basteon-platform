alter table public.game_rooms drop constraint if exists game_rooms_game_check;
alter table public.game_rooms add constraint game_rooms_game_check
  check (game in ('morabaraba','linkup','teach_one','read_room'));

update public.game_rooms
set status = case
      when created_at + interval '2 minutes' > now() then 'ready_check'
      else 'ended'
    end,
    invite_status = case
      when created_at + interval '2 minutes' > now() then 'pending'
      else 'expired'
    end,
    invite_expires_at = case
      when created_at + interval '2 minutes' > now() then created_at + interval '2 minutes'
      else null
    end,
    end_reason = case
      when created_at + interval '2 minutes' <= now() then 'timeout'
      else end_reason
    end,
    updated_at = now()
where game in ('morabaraba','linkup','teach_one','read_room')
  and guest_id is not null
  and status = 'ready_check'
  and invite_status = 'accepted'
  and invite_expires_at is null
  and updated_at = created_at;

create or replace function public.game_nearby(
  p_lat numeric,
  p_lng numeric,
  p_radius_km numeric default 1
)
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
    and abs(gp.lng - p_lng) <= p_radius_km / 111.0
    and not exists (
      select 1 from public.game_rooms room
      where room.status in ('waiting','ready_check','playing','paused')
        and (room.host_id = gp.user_id or room.guest_id = gp.user_id)
    )
    and not exists (
      select 1 from public.game_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = gp.user_id)
         or (block.blocker_id = gp.user_id and block.blocked_id = auth.uid())
    );
$$;

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
  if p_game not in ('morabaraba', 'linkup', 'teach_one', 'read_room') then raise exception 'invalid_game'; end if;
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
      select 1 from public.linkup_matches match
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
    where host_id = v_uid and guest_id = p_guest_id and game = p_game
      and status = 'ready_check' and invite_status = 'pending' and invite_expires_at > now()
    order by created_at desc
    limit 1;
    if found then return v_room; end if;
  end if;

  if exists (
    select 1 from public.game_rooms
    where status <> 'ended' and (host_id = v_uid or guest_id = v_uid)
  ) then raise exception 'room_already_open'; end if;

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

create table public.read_room_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique references public.game_rooms(id) on delete set null,
  mode text not null check (mode in ('pair','bot')),
  age_band text not null check (age_band in ('teen','adult')),
  status text not null default 'active' check (status in ('active','finished','abandoned')),
  p1 uuid not null references auth.users(id) on delete cascade,
  p2 uuid references auth.users(id) on delete cascade,
  p1_alias text not null,
  p1_avatar text not null,
  p2_alias text not null,
  p2_avatar text not null,
  round_no int not null default 1 check (round_no between 1 and 3),
  rounds_total int not null default 3 check (rounds_total = 3),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint read_room_sessions_distinct check (p2 is null or p2 <> p1)
);
create index read_room_sessions_players_idx on public.read_room_sessions (p1, p2, status);

create table public.read_room_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.read_room_sessions(id) on delete cascade,
  round_no int not null check (round_no between 1 and 3),
  scenario_id int not null check (scenario_id between 0 and 5),
  phase text not null default 'answer' check (phase in ('answer','reveal','done')),
  p1_emotion int check (p1_emotion between 0 and 3),
  p1_response int check (p1_response between 0 and 3),
  p2_emotion int check (p2_emotion between 0 and 3),
  p2_response int check (p2_response between 0 and 3),
  p1_ready boolean not null default false,
  p2_ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, round_no)
);

create table public.read_room_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.read_room_sessions(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('uncomfortable','inappropriate','other')),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  constraint read_room_reports_distinct check (reporter_id <> target_id)
);

alter table public.read_room_sessions enable row level security;
alter table public.read_room_rounds enable row level security;
alter table public.read_room_reports enable row level security;
revoke all on public.read_room_sessions, public.read_room_rounds, public.read_room_reports from anon, authenticated;
grant all on public.read_room_sessions, public.read_room_rounds, public.read_room_reports to service_role;

create or replace function public.read_room_start(
  p_room_id uuid,
  p_user uuid,
  p_session_id uuid,
  p_age_band text,
  p_p1_alias text,
  p_p1_avatar text,
  p_p2_alias text,
  p_p2_avatar text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms;
  v_session_id uuid;
begin
  if p_age_band not in ('teen','adult') then raise exception 'invalid_age_band'; end if;

  if p_room_id is null then
    insert into public.read_room_sessions (
      id, mode, age_band, status, p1, p2, p1_alias, p1_avatar, p2_alias, p2_avatar
    ) values (
      p_session_id, 'bot', p_age_band, 'active', p_user, null,
      p_p1_alias, p_p1_avatar, 'Kiki', '🐦'
    );
    return p_session_id;
  end if;

  select * into v_room
  from public.game_rooms
  where id = p_room_id and game = 'read_room'
    and status in ('ready_check','playing') and invite_status = 'accepted'
    and guest_id is not null
  for update;
  if not found or v_room.host_id <> p_user then raise exception 'room_unavailable'; end if;

  select id into v_session_id from public.read_room_sessions where room_id = p_room_id;
  if found then return v_session_id; end if;

  insert into public.read_room_sessions (
    id, room_id, mode, age_band, status, p1, p2, p1_alias, p1_avatar, p2_alias, p2_avatar
  ) values (
    p_session_id, p_room_id, 'pair', p_age_band, 'active',
    v_room.host_id, v_room.guest_id, p_p1_alias, p_p1_avatar, p_p2_alias, p_p2_avatar
  );
  update public.game_rooms set status = 'playing', updated_at = now() where id = p_room_id;
  return p_session_id;
end $$;
revoke all on function public.read_room_start(uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.read_room_start(uuid, uuid, uuid, text, text, text, text, text)
  to service_role;

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
  if p_emotion not between 0 and 3 or p_response not between 0 and 3 then
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
    if p_bot_emotion is null or p_bot_emotion not between 0 and 3
       or p_bot_response is null or p_bot_response not between 0 and 3 then
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
  if p_next_scenario_id not between 0 and 5 then raise exception 'invalid_scenario'; end if;
  select * into v_session from public.read_room_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'active'
     or (p_user <> v_session.p1 and (v_session.p2 is null or p_user <> v_session.p2)) then
    raise exception 'session_unavailable';
  end if;
  select * into v_round from public.read_room_rounds
    where session_id = p_session_id and round_no = v_session.round_no for update;
  if not found or v_round.phase <> 'reveal' then raise exception 'reveal_closed'; end if;

  update public.read_room_rounds
  set p1_ready = p1_ready or p_user = v_session.p1,
      p2_ready = p2_ready or (v_session.mode = 'bot' or p_user = v_session.p2)
  where id = v_round.id returning * into v_round;

  if not v_round.p1_ready or not v_round.p2_ready then
    return jsonb_build_object('status','active','round_no',v_session.round_no,'waiting',true);
  end if;

  update public.read_room_rounds set phase = 'done' where id = v_round.id;
  if v_session.round_no >= v_session.rounds_total then
    update public.read_room_sessions set status = 'finished', finished_at = now()
      where id = p_session_id;
    if v_session.room_id is not null then
      update public.game_rooms set status = 'post_game', updated_at = now()
        where id = v_session.room_id;
    end if;
    return jsonb_build_object('status','finished','round_no',v_session.round_no,'waiting',false);
  end if;

  update public.read_room_sessions set round_no = round_no + 1 where id = p_session_id;
  insert into public.read_room_rounds (session_id, round_no, scenario_id)
    values (p_session_id, v_session.round_no + 1, p_next_scenario_id);
  return jsonb_build_object('status','active','round_no',v_session.round_no + 1,'waiting',false);
end $$;
revoke all on function public.read_room_advance(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.read_room_advance(uuid, uuid, int)
  to service_role;

create or replace function public.read_room_leave(p_session_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.read_room_sessions;
begin
  select * into v_session from public.read_room_sessions where id = p_session_id for update;
  if not found or (p_user <> v_session.p1 and (v_session.p2 is null or p_user <> v_session.p2)) then
    raise exception 'session_unavailable';
  end if;
  if v_session.status = 'active' then
    update public.read_room_sessions set status = 'abandoned', finished_at = now() where id = p_session_id;
    if v_session.room_id is not null then
      update public.game_rooms
      set status = 'ended', ended_by = p_user, end_reason = 'left', updated_at = now()
      where id = v_session.room_id and status <> 'ended';
    end if;
  end if;
end $$;
revoke all on function public.read_room_leave(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_room_leave(uuid, uuid)
  to service_role;
