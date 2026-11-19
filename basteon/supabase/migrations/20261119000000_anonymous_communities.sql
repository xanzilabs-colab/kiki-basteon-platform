create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 60),
  description text not null check (char_length(description) between 1 and 280),
  scope text not null check (char_length(scope) between 10 and 500),
  icon_key text not null default 'shield' check (icon_key in ('shield', 'lightbulb', 'footprints', 'heart', 'users')),
  is_system boolean not null default false,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.community_memberships (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pseudonym text not null check (char_length(pseudonym) between 6 and 40),
  joined_at timestamptz not null default now(),
  welcome_read_at timestamptz,
  muted_until timestamptz,
  unique (community_id, user_id)
);

create index community_memberships_user on public.community_memberships(user_id, joined_at desc);
create index community_memberships_community on public.community_memberships(community_id);

create table public.community_posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete cascade,
  parent_id uuid references public.community_posts(id) on delete cascade,
  post_type text not null check (post_type in ('welcome', 'post', 'comment')),
  author_alias text not null check (char_length(author_alias) between 1 and 40),
  is_kiki boolean not null default false,
  body text not null check (char_length(body) between 1 and 3000),
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  check ((post_type = 'comment') = (parent_id is not null)),
  check ((is_kiki and author_user_id is null) or (not is_kiki and author_user_id is not null)),
  check (post_type <> 'welcome' or is_kiki)
);

create unique index community_one_welcome_post on public.community_posts(community_id) where post_type = 'welcome';
create index community_posts_feed on public.community_posts(community_id, created_at desc) where parent_id is null and status = 'published';
create index community_posts_replies on public.community_posts(parent_id, created_at) where post_type = 'comment' and status = 'published';
create index community_posts_author on public.community_posts(author_user_id, created_at desc);

create table public.community_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('support', 'thanks', 'care')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, reaction)
);

create index community_reactions_post on public.community_reactions(post_id);

create table public.community_moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete set null,
  decision text not null check (decision in ('redacted', 'refused')),
  categories text[] not null default '{}',
  severity smallint not null check (severity between 1 and 5),
  created_at timestamptz not null default now()
);

create index community_moderation_user_recent on public.community_moderation_events(user_id, created_at desc);

alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_moderation_events enable row level security;

revoke all on public.communities, public.community_memberships, public.community_posts,
  public.community_reactions, public.community_moderation_events from public, anon, authenticated;
grant select, insert, update, delete on public.communities, public.community_memberships,
  public.community_posts, public.community_reactions, public.community_moderation_events to service_role;

create or replace function public.join_community(p_community_id uuid, p_user_id uuid)
returns table (membership_id uuid, pseudonym text, joined_at timestamptz, welcome_read_at timestamptz, muted_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adjectives text[] := array['Calm', 'Bright', 'Kind', 'Brave', 'Gentle', 'Curious', 'Quiet', 'Steady', 'Open', 'Hopeful', 'Thoughtful', 'Sunny'];
  v_animals text[] := array['Otter', 'Panda', 'Robin', 'Fox', 'Dove', 'Turtle', 'Finch', 'Koala', 'Seal', 'Moth', 'Badger', 'Wren'];
  v_pseudonym text;
begin
  if not exists (select 1 from public.communities where id = p_community_id and is_public and is_active) then
    raise exception 'community_not_found';
  end if;

  v_pseudonym := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
    || ' ' || v_animals[1 + floor(random() * array_length(v_animals, 1))::int]
    || ' ' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  return query
    insert into public.community_memberships as membership (community_id, user_id, pseudonym)
    values (p_community_id, p_user_id, v_pseudonym)
    on conflict (community_id, user_id) do update set user_id = excluded.user_id
    returning membership.id, membership.pseudonym, membership.joined_at, membership.welcome_read_at, membership.muted_until;
end;
$$;

create or replace function public.create_community_with_welcome(
  p_user_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_scope text,
  p_icon_key text,
  p_welcome_body text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_recent_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_create:' || p_user_id::text, 0));
  select count(*) into v_recent_count
  from public.communities
  where created_by = p_user_id and created_at > now() - interval '24 hours';
  if v_recent_count >= 3 then raise exception 'rate_limited'; end if;

  insert into public.communities (slug, name, description, scope, icon_key, created_by)
  values (p_slug, p_name, p_description, p_scope, p_icon_key, p_user_id)
  returning id into v_community_id;

  insert into public.community_posts (community_id, post_type, author_alias, is_kiki, body)
  values (v_community_id, 'welcome', 'Kiki', true, p_welcome_body);

  perform public.join_community(v_community_id, p_user_id);
  return v_community_id;
end;
$$;

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
  from public.community_posts
  where author_user_id = p_user_id and created_at > now() - interval '10 minutes'
    and post_type in ('post', 'comment');
  if v_recent_count >= 12 then raise exception 'rate_limited'; end if;

  if p_parent_id is not null then
    select * into v_parent from public.community_posts
    where id = p_parent_id and community_id = p_community_id and post_type = 'post' and status = 'published';
    if not found then raise exception 'post_not_found'; end if;
  end if;

  insert into public.community_posts (community_id, author_user_id, parent_id, post_type, author_alias, body)
  values (
    p_community_id, p_user_id, p_parent_id,
    case when p_parent_id is null then 'post' else 'comment' end,
    v_membership.pseudonym, p_body
  )
  returning id into v_post_id;
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
  select r.post_id, r.reaction, count(*)::bigint, bool_or(r.user_id = p_user_id)
  from public.community_reactions r
  where r.post_id = any(coalesce(p_post_ids, '{}'::uuid[]))
  group by r.post_id, r.reaction;
$$;

create or replace function public.record_community_guardrail_event(
  p_user_id uuid,
  p_community_id uuid,
  p_decision text,
  p_categories text[],
  p_severity smallint
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_refusals integer;
  v_muted_until timestamptz;
begin
  if p_decision not in ('redacted', 'refused') or p_severity not between 1 and 5 then
    raise exception 'invalid_guardrail_event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('community_guardrail:' || p_user_id::text || ':' || coalesce(p_community_id::text, 'global'), 0));
  insert into public.community_moderation_events(user_id, community_id, decision, categories, severity)
  values (p_user_id, p_community_id, p_decision, coalesce(p_categories, '{}'), p_severity);

  select count(*) into v_recent_refusals
  from public.community_moderation_events
  where user_id = p_user_id and decision = 'refused' and severity >= 3
    and created_at > now() - interval '24 hours';

  if p_decision = 'refused' and (p_severity = 5 or v_recent_refusals >= 3) and p_community_id is not null then
    update public.community_memberships
    set muted_until = greatest(coalesce(muted_until, now()), now() + interval '1 hour')
    where user_id = p_user_id and community_id = p_community_id
    returning muted_until into v_muted_until;
  end if;

  return v_muted_until;
end;
$$;

revoke all on function public.join_community(uuid, uuid),
  public.create_community_with_welcome(uuid, text, text, text, text, text, text),
  public.create_community_post(uuid, uuid, text, uuid),
  public.community_post_reaction_summary(uuid[], uuid),
  public.record_community_guardrail_event(uuid, uuid, text, text[], smallint)
  from public, anon, authenticated;
grant execute on function public.join_community(uuid, uuid),
  public.create_community_with_welcome(uuid, text, text, text, text, text, text),
  public.create_community_post(uuid, uuid, text, uuid),
  public.community_post_reaction_summary(uuid[], uuid),
  public.record_community_guardrail_event(uuid, uuid, text, text[], smallint)
  to service_role;

insert into public.communities (slug, name, description, scope, icon_key, is_system)
values
  ('kiki-tips', 'Kiki Tips', 'Practical, calm safety ideas from Kiki.', 'Share general safety guidance and questions. Do not post personal details, contact information, exact addresses, or live locations.', 'lightbulb', true),
  ('everyday-safety', 'Everyday Safety', 'Small ideas for safer everyday routines.', 'Discuss general safety habits and resources. Keep examples broad and never identify yourself or another person.', 'shield', true),
  ('walking-together', 'Walking Together', 'Supportive ideas for planning safer walks.', 'Share route-planning tips, not live routes, meeting points, or identifiable details about walkers.', 'footprints', true),
  ('support-and-wellbeing', 'Support & Wellbeing', 'A kind place for general encouragement and coping ideas.', 'Offer supportive, non-clinical conversation. Do not share names, contact details, private health records, or identifying stories.', 'heart', true)
on conflict (slug) do nothing;

insert into public.community_posts (community_id, post_type, author_alias, is_kiki, body)
select c.id, 'welcome', 'Kiki', true,
  'Welcome. You are anonymous here under a community nickname. Kiki Guard checks every post and reply. Please share general ideas only—never names, addresses, contact details, social handles, exact locations, or identifying information about yourself or anyone else. Read the community scope before joining the conversation.'
from public.communities c
where c.is_system and not exists (
  select 1 from public.community_posts p where p.community_id = c.id and p.post_type = 'welcome'
);
