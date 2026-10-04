-- Persistent in-app notifications. Server routes (service role) are the only readers/writers;
-- browser clients never touch this table directly.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('buddy_bubble', 'system')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 500),
  href text check (href is null or href ~ '^/[A-Za-z0-9]'),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_recent on public.notifications(user_id, created_at desc);
create index notifications_user_unread on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- Buddy bubbles hold at most four people.
alter table public.buddy_bubbles add column max_members smallint not null default 4 check (max_members between 2 and 4);
create index if not exists buddy_bubble_members_user on public.buddy_bubble_members(user_id);

-- Atomically put the joiner in a bubble with the target: reuse a shared active bubble, join the
-- target's newest eligible bubble with spare capacity, or create a new two-person bubble.
create or replace function public.join_buddy_bubble(
  p_joiner uuid,
  p_joiner_trip uuid,
  p_target uuid,
  p_target_trip uuid,
  p_meeting_code text,
  p_expires_at timestamptz
) returns table (joined_bubble_id uuid, created boolean, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bubble uuid;
  v_count integer;
  v_max integer;
begin
  if p_joiner = p_target then raise exception 'invalid_target'; end if;

  -- Serialise joins between the same pair so mutual joins cannot create duplicate bubbles.
  perform pg_advisory_xact_lock(hashtextextended('buddy_pair:' || least(p_joiner::text, p_target::text) || ':' || greatest(p_joiner::text, p_target::text), 0));

  select b.id into v_bubble
  from public.buddy_bubbles b
  join public.buddy_bubble_members t on t.bubble_id = b.id and t.user_id = p_target
  join public.buddy_bubble_members j on j.bubble_id = b.id and j.user_id = p_joiner
  where b.closed_at is null and b.expires_at > now()
  order by b.created_at desc
  limit 1;
  if v_bubble is not null then
    return query select v_bubble, false, true;
    return;
  end if;

  for v_bubble in
    select b.id
    from public.buddy_bubbles b
    join public.buddy_bubble_members t on t.bubble_id = b.id and t.user_id = p_target
    where b.closed_at is null and b.expires_at > now()
      and not exists (
        select 1 from public.buddy_bubble_members o
        join public.buddy_blocks k
          on (k.user_id = o.user_id and k.blocked_user_id = p_joiner)
          or (k.user_id = p_joiner and k.blocked_user_id = o.user_id)
        where o.bubble_id = b.id
      )
    order by b.created_at desc, b.id
  loop
    select b.max_members into v_max from public.buddy_bubbles b
    where b.id = v_bubble and b.closed_at is null and b.expires_at > now()
    for update;
    if not found then continue; end if;
    select count(*) into v_count from public.buddy_bubble_members m where m.bubble_id = v_bubble;
    if v_count < v_max then
      insert into public.buddy_bubble_members (bubble_id, user_id, trip_id) values (v_bubble, p_joiner, p_joiner_trip);
      return query select v_bubble, false, false;
      return;
    end if;
  end loop;

  insert into public.buddy_bubbles (meeting_code, expires_at) values (p_meeting_code, p_expires_at) returning id into v_bubble;
  insert into public.buddy_bubble_members (bubble_id, user_id, trip_id)
  values (v_bubble, p_target, p_target_trip), (v_bubble, p_joiner, p_joiner_trip);
  return query select v_bubble, true, false;
end;
$$;

revoke all on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;
