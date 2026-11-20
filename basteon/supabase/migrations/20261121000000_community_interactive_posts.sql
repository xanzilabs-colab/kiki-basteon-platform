create extension if not exists pgcrypto;

alter table public.community_posts
  add column if not exists author_membership_id uuid references public.community_memberships(id) on delete cascade,
  add column if not exists title text,
  add column if not exists category_group text not null default 'general',
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists ends_at timestamptz,
  add column if not exists guard_removed text[] not null default '{}',
  add column if not exists comment_kind text not null default 'reply',
  add column if not exists stance text,
  add column if not exists host_answer text,
  add column if not exists host_answered_at timestamptz,
  add column if not exists like_count integer not null default 0,
  add column if not exists helpful_count integer not null default 0,
  add column if not exists parent_attempt_post_id uuid references public.community_posts(id) on delete set null;

insert into public.community_memberships (community_id, user_id, pseudonym)
select identity.community_id, identity.user_id,
  'Member ' || upper(substr(replace(identity.user_id::text, '-', ''), 1, 6))
from (
  select distinct community_id, author_user_id as user_id
  from public.community_posts
  where author_user_id is not null
  union
  select distinct p.community_id, r.user_id
  from public.community_reactions r
  join public.community_posts p on p.id = r.post_id
) identity
on conflict (community_id, user_id) do nothing;

update public.community_posts p
set author_membership_id = m.id
from public.community_memberships m
where p.author_user_id = m.user_id
  and p.community_id = m.community_id
  and p.author_membership_id is null;

drop function if exists public.create_community_post(uuid, uuid, text, uuid);
drop function if exists public.community_post_reaction_summary(uuid[], uuid);

alter table public.community_reactions
  add column if not exists membership_id uuid references public.community_memberships(id) on delete cascade;

update public.community_reactions r
set membership_id = m.id
from public.community_posts p, public.community_memberships m
where r.post_id = p.id
  and r.user_id = m.user_id
  and p.community_id = m.community_id
  and r.membership_id is null;

delete from public.community_reactions where membership_id is null;
alter table public.community_reactions drop constraint if exists community_reactions_pkey;
alter table public.community_reactions alter column membership_id set not null;
alter table public.community_reactions drop column user_id;
alter table public.community_reactions
  add constraint community_reactions_pkey primary key (post_id, membership_id, reaction);

drop index if exists public.community_posts_author;
alter table public.community_posts drop constraint if exists community_posts_post_type_check;
alter table public.community_posts drop constraint if exists community_posts_check;
alter table public.community_posts drop constraint if exists community_posts_check1;
alter table public.community_posts drop constraint if exists community_posts_check2;
alter table public.community_posts drop constraint if exists community_posts_body_check;
alter table public.community_posts drop constraint if exists community_posts_author_alias_check;
alter table public.community_posts drop column author_user_id;
alter table public.community_posts alter column body drop not null;
alter table public.community_posts
  add constraint community_posts_post_type_check
    check (post_type in ('welcome', 'post', 'comment', 'carousel', 'poll', 'tt', 'slider', 'fill', 'cap', 'hot', 'quiz', 'mf', 'hunt', 'chal', 'ama', 'decide', 'path')),
  add constraint community_posts_body_check
    check (body is null or char_length(body) <= 3000),
  add constraint community_posts_title_check
    check (title is null or char_length(title) <= 160),
  add constraint community_posts_category_check
    check (category_group in ('general', 'carousel', 'vote', 'prompts', 'games', 'cocreate')),
  add constraint community_posts_comment_kind_check
    check (comment_kind in ('reply', 'answer', 'question')),
  add constraint community_posts_stance_check
    check (stance is null or stance in ('Agree', 'Nuance', 'Disagree')),
  add constraint community_posts_content_check
    check (
      (post_type in ('welcome', 'comment') and body is not null and char_length(body) between 1 and 3000)
      or (post_type not in ('welcome', 'comment') and (nullif(title, '') is not null or nullif(body, '') is not null))
    ),
  add constraint community_posts_parent_check
    check ((post_type = 'comment') = (parent_id is not null)),
  add constraint community_posts_author_check
    check ((is_kiki and author_membership_id is null) or (not is_kiki and author_membership_id is not null)),
  add constraint community_posts_welcome_check
    check (post_type <> 'welcome' or is_kiki);

create index community_posts_member_author on public.community_posts(author_membership_id, created_at desc);
create index community_posts_group_feed on public.community_posts(community_id, category_group, created_at desc, id desc)
  where parent_id is null and status = 'published';

create table public.community_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  position smallint not null check (position between 0 and 9),
  storage_path text not null unique,
  width integer not null check (width between 1 and 4000),
  height integer not null check (height between 1 and 4000),
  caption text check (char_length(caption) <= 120),
  alt_text text check (char_length(alt_text) <= 200),
  unique (post_id, position)
);

create table public.community_post_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  label text not null check (char_length(label) between 1 and 90),
  sub_label text check (char_length(sub_label) <= 60),
  unique (post_id, position),
  unique (id, post_id)
);

create table public.community_post_secrets (
  post_id uuid primary key references public.community_posts(id) on delete cascade,
  correct_option_id uuid,
  explanation text check (char_length(explanation) <= 280),
  foreign key (correct_option_id, post_id)
    references public.community_post_options(id, post_id) on delete cascade
);

create table public.community_hunt_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  x numeric(5,2) not null check (x between 0 and 100),
  y numeric(5,2) not null check (y between 0 and 100),
  label text not null check (char_length(label) between 1 and 60),
  unique (post_id, position)
);

create table public.community_post_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  option_id uuid not null,
  is_correct boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, membership_id),
  foreign key (option_id, post_id)
    references public.community_post_options(id, post_id) on delete cascade
);
create index community_post_votes_option on public.community_post_votes(post_id, option_id);

create table public.community_post_ratings (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  value smallint not null check (value between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (post_id, membership_id)
);

create table public.community_post_comment_likes (
  comment_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  primary key (comment_id, membership_id)
);

create table public.community_post_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, membership_id)
);

create table public.community_post_helpful (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, membership_id)
);

create table public.community_challenge_enrollments (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (post_id, membership_id)
);

create table public.community_challenge_checkins (
  post_id uuid not null,
  membership_id uuid not null,
  day date not null,
  primary key (post_id, membership_id, day),
  foreign key (post_id, membership_id)
    references public.community_challenge_enrollments(post_id, membership_id) on delete cascade
);

create table public.community_hunt_attempts (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  x numeric(5,2) not null check (x between 0 and 100),
  y numeric(5,2) not null check (y between 0 and 100),
  hit boolean not null,
  created_at timestamptz not null default now()
);
create index community_hunt_attempts_member on public.community_hunt_attempts(post_id, membership_id);

create table public.community_hunt_found (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  target_id uuid not null references public.community_hunt_targets(id) on delete cascade,
  found_at timestamptz not null default now(),
  primary key (post_id, membership_id, target_id)
);

create table public.community_path_visits (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  end_node smallint not null,
  created_at timestamptz not null default now()
);

create table public.community_guard_events (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.community_memberships(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  surface text not null,
  items text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index community_guard_events_recent on public.community_guard_events(membership_id, created_at desc);

create table public.community_stories (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  emoji text not null default '🛡️',
  byline text not null check (char_length(byline) between 1 and 60),
  body text not null check (char_length(body) between 1 and 280),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create table public.community_activity_seen (
  membership_id uuid primary key references public.community_memberships(id) on delete cascade,
  seen_at timestamptz not null default now()
);

create or replace function public.create_community_post(
  p_community_id uuid,
  p_user_id uuid,
  p_body text,
  p_parent_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.community_memberships%rowtype;
  v_parent public.community_posts%rowtype;
  v_post_id uuid;
  v_recent_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_post:' || p_user_id::text, 0));
  select * into v_membership
  from public.community_memberships
  where community_id = p_community_id and user_id = p_user_id
  for update;
  if not found then raise exception 'not_member'; end if;
  if v_membership.muted_until is not null and v_membership.muted_until > now() then raise exception 'muted'; end if;
  if v_membership.welcome_read_at is null then raise exception 'welcome_unread'; end if;

  select count(*) into v_recent_count
  from public.community_posts p
  join public.community_memberships m on m.id = p.author_membership_id
  where m.user_id = p_user_id and p.created_at > now() - interval '10 minutes'
    and p.post_type in ('post', 'comment', 'carousel', 'poll', 'tt', 'slider', 'fill', 'cap', 'hot', 'quiz', 'mf', 'hunt', 'chal', 'ama', 'decide', 'path');
  if v_recent_count >= 12 then raise exception 'rate_limited'; end if;

  if p_parent_id is not null then
    select * into v_parent from public.community_posts
    where id = p_parent_id and community_id = p_community_id
      and post_type not in ('welcome', 'comment') and status = 'published';
    if not found then raise exception 'post_not_found'; end if;
  end if;

  insert into public.community_posts (
    community_id, author_membership_id, parent_id, post_type, author_alias, is_kiki, body, comment_kind
  ) values (
    p_community_id, v_membership.id, p_parent_id,
    case when p_parent_id is null then 'post' else 'comment' end,
    v_membership.pseudonym, false, p_body, 'reply'
  ) returning id into v_post_id;
  return v_post_id;
end;
$$;

create or replace function public.community_post_reaction_summary(p_post_ids uuid[], p_user_id uuid)
returns table (post_id uuid, reaction text, reaction_count bigint, viewer_reacted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.post_id, r.reaction, count(*)::bigint,
    bool_or(r.membership_id = m.id)
  from public.community_reactions r
  join public.community_posts p on p.id = r.post_id
  left join public.community_memberships m
    on m.community_id = p.community_id and m.user_id = p_user_id
  where r.post_id = any(coalesce(p_post_ids, '{}'::uuid[]))
  group by r.post_id, r.reaction;
$$;

create or replace function public.create_community_interactive_post(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (p_payload->>'user_id')::uuid;
  v_community_id uuid := (p_payload->>'community_id')::uuid;
  v_type text := p_payload->>'type';
  v_membership public.community_memberships%rowtype;
  v_post_id uuid;
  v_option jsonb;
  v_option_id uuid;
  v_position integer := 0;
  v_correct_option_id uuid;
  v_recent_count integer;
  v_group text;
begin
  if v_type not in ('post', 'carousel', 'poll', 'tt', 'slider', 'fill', 'cap', 'hot', 'quiz', 'mf', 'hunt', 'chal', 'ama', 'decide', 'path') then
    raise exception 'invalid_post_type';
  end if;
  select * into v_membership from public.community_memberships
    where community_id = v_community_id and user_id = v_user_id for update;
  if not found then raise exception 'not_member'; end if;
  if v_membership.welcome_read_at is null then raise exception 'welcome_unread'; end if;
  if v_membership.muted_until is not null and v_membership.muted_until > now() then raise exception 'muted'; end if;

  perform pg_advisory_xact_lock(hashtextextended('community_interactive_post:' || v_user_id::text, 0));
  select count(*) into v_recent_count from public.community_posts p
    join public.community_memberships m on m.id = p.author_membership_id
    where m.user_id = v_user_id and p.parent_id is null
      and p.created_at > now() - interval '1 hour'
      and p.post_type not in ('welcome', 'comment');
  if v_recent_count >= 10 then raise exception 'rate_limited'; end if;

  v_group := case
    when v_type = 'carousel' then 'carousel'
    when v_type in ('poll', 'tt', 'slider', 'decide', 'hot') then case when v_type = 'decide' then 'cocreate' when v_type = 'hot' then 'prompts' else 'vote' end
    when v_type in ('fill', 'cap') then 'prompts'
    when v_type in ('quiz', 'mf', 'hunt', 'chal') then 'games'
    when v_type in ('ama', 'path') then 'cocreate'
    else 'general'
  end;
  insert into public.community_posts (
    community_id, author_membership_id, post_type, author_alias, is_kiki, body, title,
    category_group, config, ends_at, guard_removed, parent_attempt_post_id
  ) values (
    v_community_id, v_membership.id, v_type, v_membership.pseudonym, false,
    nullif(p_payload->>'body', ''), nullif(p_payload->>'title', ''),
    v_group, coalesce(p_payload->'config', '{}'::jsonb),
    case when v_type = 'decide' then now() + interval '3 days' else null end,
    coalesce(array(select jsonb_array_elements_text(p_payload->'guard_removed')), '{}'),
    nullif(p_payload->>'parent_attempt_post_id', '')::uuid
  ) returning id into v_post_id;

  for v_option in select value from jsonb_array_elements(coalesce(p_payload->'options', '[]'::jsonb)) loop
    insert into public.community_post_options(post_id, position, label, sub_label)
      values (v_post_id, v_position, v_option->>'label', nullif(v_option->>'sub_label', ''))
      returning id into v_option_id;
    if coalesce((v_option->>'correct')::boolean, false) then v_correct_option_id := v_option_id; end if;
    v_position := v_position + 1;
  end loop;

  if v_type in ('quiz', 'mf') then
    if v_correct_option_id is null then raise exception 'correct_option_required'; end if;
    insert into public.community_post_secrets(post_id, correct_option_id, explanation)
      values (v_post_id, v_correct_option_id, nullif(p_payload->'secret'->>'explanation', ''));
  elsif v_type = 'hunt' then
    insert into public.community_post_secrets(post_id) values (v_post_id);
    insert into public.community_hunt_targets(post_id, position, x, y, label)
      select v_post_id, (item->>'position')::smallint, (item->>'x')::numeric, (item->>'y')::numeric, item->>'label'
      from jsonb_array_elements(coalesce(p_payload->'targets', '[]'::jsonb)) item;
  end if;

  insert into public.community_post_media(post_id, position, storage_path, width, height, caption, alt_text)
    select v_post_id, (item->>'position')::smallint, item->>'storage_path',
      (item->>'width')::integer, (item->>'height')::integer,
      nullif(item->>'caption', ''), nullif(item->>'alt_text', '')
    from jsonb_array_elements(coalesce(p_payload->'media', '[]'::jsonb)) item;
  return v_post_id;
end;
$$;

create or replace function public.community_interactive_vote(p_post_id uuid, p_user_id uuid, p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.community_posts%rowtype;
  v_member_id uuid;
  v_secret public.community_post_secrets%rowtype;
  v_correct boolean;
  v_existing uuid;
begin
  select * into v_post from public.community_posts where id = p_post_id and status = 'published' and parent_id is null;
  if not found then raise exception 'post_not_found'; end if;
  select id into v_member_id from public.community_memberships
    where community_id = v_post.community_id and user_id = p_user_id and welcome_read_at is not null;
  if v_member_id is null then raise exception 'not_a_member'; end if;
  if v_post.post_type not in ('poll', 'tt', 'decide', 'hot', 'quiz', 'mf') then raise exception 'wrong_type'; end if;
  if v_post.ends_at is not null and v_post.ends_at <= now() then raise exception 'voting_closed'; end if;
  if not exists (select 1 from public.community_post_options where id = p_option_id and post_id = p_post_id) then raise exception 'invalid_option'; end if;

  if v_post.post_type in ('quiz', 'mf') then
    select * into v_secret from public.community_post_secrets where post_id = p_post_id;
    v_correct := p_option_id = v_secret.correct_option_id;
    insert into public.community_post_votes(post_id, membership_id, option_id, is_correct)
      values (p_post_id, v_member_id, p_option_id, v_correct)
      on conflict (post_id, membership_id) do nothing;
    if not found then raise exception 'already_answered'; end if;
    return jsonb_build_object(
      'my_option_id', p_option_id, 'is_correct', v_correct,
      'correct_option_id', v_secret.correct_option_id, 'explanation', v_secret.explanation,
      'pct_correct', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0)) from public.community_post_votes where post_id = p_post_id)
    );
  end if;

  insert into public.community_post_votes(post_id, membership_id, option_id)
    values (p_post_id, v_member_id, p_option_id)
    on conflict (post_id, membership_id) do update set option_id = excluded.option_id, updated_at = now();
  select option_id into v_existing from public.community_post_votes where post_id = p_post_id and membership_id = v_member_id;
  return jsonb_build_object('my_option_id', v_existing, 'tallies', (
    select jsonb_agg(jsonb_build_object('option_id', o.id, 'votes', coalesce(v.n, 0)) order by o.position)
    from public.community_post_options o
    left join (select option_id, count(*) n from public.community_post_votes where post_id = p_post_id group by option_id) v on v.option_id = o.id
    where o.post_id = p_post_id
  ));
end;
$$;

create or replace function public.community_interactive_rate(p_post_id uuid, p_user_id uuid, p_value integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_member_id uuid; v_community_id uuid;
begin
  if p_value not between 0 and 100 then raise exception 'invalid_rating'; end if;
  select community_id into v_community_id from public.community_posts
    where id = p_post_id and post_type = 'slider' and status = 'published' and parent_id is null;
  if not found then raise exception 'post_not_found'; end if;
  select id into v_member_id from public.community_memberships
    where community_id = v_community_id and user_id = p_user_id and welcome_read_at is not null;
  if v_member_id is null then raise exception 'not_a_member'; end if;
  insert into public.community_post_ratings(post_id, membership_id, value)
    values (p_post_id, v_member_id, p_value) on conflict do nothing;
  if not found then raise exception 'already_rated'; end if;
  return (select jsonb_build_object('avg', round(avg(value)), 'n', count(*))
    from public.community_post_ratings where post_id = p_post_id);
end;
$$;

create or replace function public.community_interactive_challenge(p_post_id uuid, p_user_id uuid, p_checkin boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_community_id uuid; v_member_id uuid; v_joined boolean; v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  select community_id into v_community_id from public.community_posts
    where id = p_post_id and post_type = 'chal' and status = 'published' and parent_id is null;
  if not found then raise exception 'post_not_found'; end if;
  select id into v_member_id from public.community_memberships
    where community_id = v_community_id and user_id = p_user_id and welcome_read_at is not null;
  if v_member_id is null then raise exception 'not_a_member'; end if;
  if p_checkin then
    if not exists (select 1 from public.community_challenge_enrollments where post_id = p_post_id and membership_id = v_member_id) then raise exception 'not_enrolled'; end if;
    insert into public.community_challenge_checkins(post_id, membership_id, day)
      values (p_post_id, v_member_id, v_today) on conflict do nothing;
  else
    delete from public.community_challenge_enrollments where post_id = p_post_id and membership_id = v_member_id;
    v_joined := not found;
    if v_joined then insert into public.community_challenge_enrollments(post_id, membership_id) values (p_post_id, v_member_id); end if;
  end if;
  return jsonb_build_object(
    'joined', exists (select 1 from public.community_challenge_enrollments where post_id = p_post_id and membership_id = v_member_id),
    'participants', (select count(*) from public.community_challenge_enrollments where post_id = p_post_id),
    'days_done', (select coalesce(jsonb_agg(day order by day), '[]'::jsonb) from public.community_challenge_checkins where post_id = p_post_id and membership_id = v_member_id),
    'today_done', exists (select 1 from public.community_challenge_checkins where post_id = p_post_id and membership_id = v_member_id and day = v_today),
    'streak', (with days as (
       select day, day - (row_number() over (order by day))::integer as grp
       from public.community_challenge_checkins where post_id = p_post_id and membership_id = v_member_id
     ), last_group as (select grp, max(day) last_day from days group by grp order by max(day) desc limit 1)
     select coalesce((select count(*) from days join last_group using (grp)
       where last_group.last_day >= v_today - 1), 0))
  );
end;
$$;

create or replace function public.community_interactive_hunt_guess(p_post_id uuid, p_user_id uuid, p_x numeric, p_y numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_community_id uuid; v_member_id uuid; v_total integer; v_found integer; v_tries integer; v_target public.community_hunt_targets%rowtype;
begin
  if p_x not between 0 and 100 or p_y not between 0 and 100 then raise exception 'bad_coords'; end if;
  select community_id into v_community_id from public.community_posts
    where id = p_post_id and post_type = 'hunt' and status = 'published';
  if not found then raise exception 'post_not_found'; end if;
  select id into v_member_id from public.community_memberships
    where community_id = v_community_id and user_id = p_user_id and welcome_read_at is not null;
  if v_member_id is null then raise exception 'not_a_member'; end if;
  select count(*) into v_total from public.community_hunt_targets where post_id = p_post_id;
  select count(*) into v_found from public.community_hunt_found where post_id = p_post_id and membership_id = v_member_id;
  select count(*) into v_tries from public.community_hunt_attempts where post_id = p_post_id and membership_id = v_member_id;
  if v_found >= v_total then raise exception 'already_complete'; end if;
  if v_tries >= 60 then raise exception 'too_many_attempts'; end if;

  select t.* into v_target
  from public.community_hunt_targets t
  where t.post_id = p_post_id
    and not exists (select 1 from public.community_hunt_found f where f.post_id = p_post_id and f.membership_id = v_member_id and f.target_id = t.id)
    and sqrt(power(p_x - t.x, 2) + power(p_y - t.y, 2)) <= coalesce((select (config->>'hit_radius')::numeric
      from public.community_posts where id = p_post_id), 8)
  order by sqrt(power(p_x - t.x, 2) + power(p_y - t.y, 2)) limit 1;
  insert into public.community_hunt_attempts(post_id, membership_id, x, y, hit)
    values (p_post_id, v_member_id, p_x, p_y, v_target.id is not null);
  if v_target.id is not null then
    insert into public.community_hunt_found(post_id, membership_id, target_id)
      values (p_post_id, v_member_id, v_target.id);
    v_found := v_found + 1;
  end if;
  return jsonb_build_object(
    'hit', v_target.id is not null, 'tries', v_tries + 1, 'found', v_found, 'total', v_total,
    'complete', v_found = v_total,
    'target', case when v_target.id is not null then jsonb_build_object('id', v_target.id, 'label', v_target.label, 'x', v_target.x, 'y', v_target.y) end
  );
end;
$$;

create or replace function public.community_interactive_path_finish(p_post_id uuid, p_user_id uuid, p_end_node integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_community_id uuid; v_member_id uuid;
begin
  select community_id into v_community_id from public.community_posts
    where id = p_post_id and post_type = 'path' and status = 'published';
  if not found then raise exception 'post_not_found'; end if;
  select id into v_member_id from public.community_memberships
    where community_id = v_community_id and user_id = p_user_id and welcome_read_at is not null;
  if v_member_id is null then raise exception 'not_a_member'; end if;
  insert into public.community_path_visits(post_id, membership_id, end_node) values (p_post_id, v_member_id, p_end_node);
end;
$$;

create or replace function public.community_bump_interaction_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_post_id uuid; v_delta integer;
begin
  v_post_id := case when tg_op = 'INSERT' then new.post_id else old.post_id end;
  v_delta := case when tg_op = 'INSERT' then 1 else -1 end;
  execute format('update public.community_posts set %I = greatest(0, %I + $1) where id = $2', tg_argv[0], tg_argv[0])
    using v_delta, v_post_id;
  return null;
end;
$$;

create trigger community_post_like_count after insert or delete on public.community_post_likes
  for each row execute function public.community_bump_interaction_count('like_count');
create trigger community_post_helpful_count after insert or delete on public.community_post_helpful
  for each row execute function public.community_bump_interaction_count('helpful_count');

alter table public.community_post_media enable row level security;
alter table public.community_post_options enable row level security;
alter table public.community_post_secrets enable row level security;
alter table public.community_hunt_targets enable row level security;
alter table public.community_post_votes enable row level security;
alter table public.community_post_ratings enable row level security;
alter table public.community_post_comment_likes enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_post_helpful enable row level security;
alter table public.community_challenge_enrollments enable row level security;
alter table public.community_challenge_checkins enable row level security;
alter table public.community_hunt_attempts enable row level security;
alter table public.community_hunt_found enable row level security;
alter table public.community_path_visits enable row level security;
alter table public.community_guard_events enable row level security;
alter table public.community_stories enable row level security;
alter table public.community_activity_seen enable row level security;

revoke all on public.community_post_media, public.community_post_options, public.community_post_secrets,
  public.community_hunt_targets, public.community_post_votes, public.community_post_ratings,
  public.community_post_comment_likes, public.community_post_likes, public.community_post_helpful,
  public.community_challenge_enrollments, public.community_challenge_checkins,
  public.community_hunt_attempts, public.community_hunt_found, public.community_path_visits,
  public.community_guard_events, public.community_stories, public.community_activity_seen
  from public, anon, authenticated;
grant select, insert, update, delete on public.community_post_media, public.community_post_options,
  public.community_post_secrets, public.community_hunt_targets, public.community_post_votes,
  public.community_post_ratings, public.community_post_comment_likes, public.community_post_likes,
  public.community_post_helpful, public.community_challenge_enrollments, public.community_challenge_checkins,
  public.community_hunt_attempts, public.community_hunt_found, public.community_path_visits,
  public.community_guard_events, public.community_stories, public.community_activity_seen to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.create_community_post(uuid, uuid, text, uuid),
  public.community_post_reaction_summary(uuid[], uuid),
  public.create_community_interactive_post(jsonb),
  public.community_interactive_vote(uuid, uuid, uuid),
  public.community_interactive_rate(uuid, uuid, integer),
  public.community_interactive_challenge(uuid, uuid, boolean),
  public.community_interactive_hunt_guess(uuid, uuid, numeric, numeric),
  public.community_interactive_path_finish(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.create_community_post(uuid, uuid, text, uuid),
  public.community_post_reaction_summary(uuid[], uuid),
  public.create_community_interactive_post(jsonb),
  public.community_interactive_vote(uuid, uuid, uuid),
  public.community_interactive_rate(uuid, uuid, integer),
  public.community_interactive_challenge(uuid, uuid, boolean),
  public.community_interactive_hunt_guess(uuid, uuid, numeric, numeric),
  public.community_interactive_path_finish(uuid, uuid, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-images', 'community-images', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/webp'];
