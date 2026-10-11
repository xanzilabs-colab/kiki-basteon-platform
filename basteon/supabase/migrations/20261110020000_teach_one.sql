create table public.teach_topics (
  id text primary key,
  title text not null,
  blurb text,
  teen_ok boolean not null default false,
  verified_only boolean not null default false,
  content_note text,
  sort int not null default 0,
  active boolean not null default true
);

create table public.teach_verified_authors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  area text,
  verified_by text not null,
  verified_at timestamptz not null default now()
);

create table public.teach_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age_band text not null check (age_band in ('teen','adult')),
  alias text not null,
  avatar text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teach_cards (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  topic_id text not null references public.teach_topics(id),
  problem text not null,
  tip text not null,
  example text,
  check_q text not null,
  check_options jsonb not null,
  check_answer smallint not null check (check_answer between 0 and 2),
  tier text not null default 'community' check (tier in ('seed','verified','community')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','removed')),
  helpful_distinct int not null default 0,
  report_count int not null default 0,
  flagged boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index teach_cards_lib_idx on public.teach_cards (topic_id, status, tier);

create table public.teach_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid unique references public.game_rooms(id) on delete set null,
  mode text not null check (mode in ('pair','bot')),
  age_band text not null check (age_band in ('teen','adult')),
  category text,
  status text not null default 'waiting' check (status in ('waiting','active','finished','abandoned')),
  p1 uuid not null references auth.users(id) on delete cascade,
  p2 uuid references auth.users(id) on delete cascade,
  p1_alias text not null,
  p1_avatar text not null,
  p2_alias text not null,
  p2_avatar text not null,
  round_no int not null default 0,
  rounds_total int not null default 3,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint teach_sessions_distinct check (p2 is null or p2 <> p1)
);
create index teach_sessions_wait_idx on public.teach_sessions (status, age_band, category, created_at);

create table public.teach_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.teach_sessions(id) on delete cascade,
  round_no int not null,
  topic_id text not null references public.teach_topics(id),
  card_p1 uuid references public.teach_cards(id),
  card_p2 uuid references public.teach_cards(id),
  phase text not null default 'write' check (phase in ('write','read','done')),
  phase_started_at timestamptz not null default now(),
  unique (session_id, round_no)
);

create table public.teach_ratings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.teach_cards(id) on delete cascade,
  rater_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('helpful','try','not_for_me')),
  quiz_correct boolean,
  created_at timestamptz not null default now(),
  unique (card_id, rater_id)
);

create table public.teach_toolbox (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.teach_cards(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table public.teach_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  teacher_xp int not null default 0,
  learner_xp int not null default 0,
  cards_authored int not null default 0,
  cards_helpful int not null default 0,
  badges jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table public.teach_reports (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.teach_cards(id) on delete cascade,
  session_id uuid references public.teach_sessions(id) on delete set null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now()
);

create table public.teach_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  constraint teach_blocks_distinct check (user_id <> blocked_id)
);

create table public.teach_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null,
  request_count int not null default 1,
  primary key (user_id, action)
);

do $$
declare t text;
begin
  foreach t in array array[
    'teach_topics','teach_verified_authors','teach_members','teach_cards','teach_sessions',
    'teach_rounds','teach_ratings','teach_toolbox','teach_progress','teach_reports',
    'teach_blocks','teach_rate_limits'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

alter table public.game_rooms drop constraint if exists game_rooms_game_check;
alter table public.game_rooms add constraint game_rooms_game_check
  check (game in ('morabaraba','linkup','teach_one'));
alter table public.game_rooms
  add column teach_session_id uuid unique references public.teach_sessions(id) on delete set null;

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
  if p_game not in ('morabaraba', 'linkup', 'teach_one') then raise exception 'invalid_game'; end if;
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

create or replace function public.teach_start_room_session(
  p_room_id uuid,
  p_user uuid,
  p_session_id uuid,
  p_age_band text,
  p_category text,
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
  v_id uuid;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id and game = 'teach_one'
    and status in ('ready_check','playing') and invite_status = 'accepted'
    and guest_id is not null
  for update;
  if not found or (v_room.host_id <> p_user and v_room.guest_id <> p_user) then
    raise exception 'room_unavailable';
  end if;
  if v_room.teach_session_id is not null then return v_room.teach_session_id; end if;
  if p_age_band not in ('teen','adult') then raise exception 'invalid_age_band'; end if;

  insert into public.teach_sessions (
    id, room_id, mode, age_band, category, status, p1, p2,
    p1_alias, p1_avatar, p2_alias, p2_avatar, round_no, started_at
  ) values (
    p_session_id, p_room_id, 'pair', p_age_band, p_category, 'active',
    v_room.host_id, v_room.guest_id,
    p_p1_alias, p_p1_avatar, p_p2_alias, p_p2_avatar, 1, now()
  );
  update public.game_rooms
  set teach_session_id = p_session_id, status = 'playing', updated_at = now()
  where id = p_room_id;
  return p_session_id;
end $$;
revoke all on function public.teach_start_room_session(uuid, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.teach_start_room_session(uuid, uuid, uuid, text, text, text, text, text, text)
  to service_role;

create or replace function public.teach_refresh_card(p_card uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.teach_cards c
     set helpful_distinct = (
           select count(distinct r.rater_id) from public.teach_ratings r
           where r.card_id = c.id and r.rating = 'helpful'
         ),
         report_count = (
           select count(*) from public.teach_reports rp
           where rp.card_id = c.id and rp.status = 'open'
         )
   where c.id = p_card;
end $$;
revoke all on function public.teach_refresh_card(uuid) from public, anon, authenticated;
grant execute on function public.teach_refresh_card(uuid) to service_role;

create or replace function public.teach_rate_limit(p_user uuid, p_action text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  insert into public.teach_rate_limits(user_id, action, window_started_at, request_count)
  values (p_user, p_action, now(), 1)
  on conflict (user_id, action) do update
    set window_started_at = case
          when public.teach_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then now()
          else public.teach_rate_limits.window_started_at
        end,
        request_count = case
          when public.teach_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
            then 1
          else public.teach_rate_limits.request_count + 1
        end
  returning request_count into v_count;
  return v_count <= p_limit;
end $$;
revoke all on function public.teach_rate_limit(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.teach_rate_limit(uuid, text, int, int) to service_role;

create or replace function public.teach_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.teach_sessions
  where (status in ('finished','abandoned') and coalesce(finished_at, created_at) < now() - interval '30 days')
     or (status = 'waiting' and created_at < now() - interval '2 minutes');
  delete from public.teach_rate_limits
  where window_started_at < now() - interval '1 day';
end $$;
revoke all on function public.teach_cleanup() from public, anon, authenticated;
grant execute on function public.teach_cleanup() to service_role;

insert into public.teach_topics (id, title, blurb, teen_ok, verified_only, sort) values
  ('cv_and_jobs','CVs and jobs','Get noticed by employers',true,false,1),
  ('budgeting','Budgeting','Make money stretch',true,false,2),
  ('small_business','Small business','Start and grow small',false,false,3),
  ('staying_safe_online','Staying safe online','Protect your accounts',true,false,4),
  ('cooking_on_a_budget','Cooking on a budget','Good food, small cost',true,false,5),
  ('study_skills','Study skills','Learn smarter',true,false,6),
  ('wellbeing_habits','Wellbeing habits','Small habits that help',true,false,7),
  ('know_your_rights','Know your rights','Verified authors only',false,true,8);

create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'teach-cleanup') then
    perform cron.schedule('teach-cleanup', '*/15 * * * *', 'select public.teach_cleanup()');
  end if;
end $$;
