-- Private, append-only Buddy activity. These records retain safe aliases and action timing,
-- never names, contact details, routes, or exact locations.
alter table public.buddy_bubble_members
  add column if not exists left_at timestamptz;

create table if not exists public.buddy_audit_events (
  id bigint generated always as identity primary key,
  bubble_id uuid references public.buddy_bubbles(id) on delete set null,
  trip_id uuid references public.buddy_trips(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_alias text,
  event text not null check (event in (
    'trip_created', 'bubble_created', 'member_joined', 'quick_update',
    'meeting_confirmed', 'virtual_walk_started', 'virtual_walk_answered',
    'virtual_walk_ended', 'safety_reported', 'buddy_blocked', 'member_left', 'bubble_closed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists buddy_audit_events_actor_recent on public.buddy_audit_events(actor_id, created_at desc);
create index if not exists buddy_audit_events_bubble_recent on public.buddy_audit_events(bubble_id, created_at desc);
alter table public.buddy_audit_events enable row level security;
revoke all on public.buddy_audit_events from anon, authenticated;

-- Leaves preserve the member record for auditing but remove access to the active Bubble.
create or replace function public.leave_buddy_bubble(p_bubble_id uuid, p_user_id uuid, p_alias text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_members integer;
begin
  perform 1 from public.buddy_bubbles where id = p_bubble_id for update;
  if not found then return 'not_found'; end if;

  update public.buddy_bubble_members
  set left_at = now()
  where bubble_id = p_bubble_id and user_id = p_user_id and left_at is null;
  if not found then return 'not_member'; end if;

  insert into public.buddy_audit_events (bubble_id, actor_id, actor_alias, event)
  values (p_bubble_id, p_user_id, p_alias, 'member_left');

  select count(*) into v_open_members
  from public.buddy_bubble_members
  where bubble_id = p_bubble_id and left_at is null;
  if v_open_members = 0 then
    update public.buddy_bubbles set closed_at = coalesce(closed_at, now()) where id = p_bubble_id;
    insert into public.buddy_audit_events (bubble_id, event)
    values (p_bubble_id, 'bubble_closed');
  end if;
  return 'left';
end;
$$;

revoke all on function public.leave_buddy_bubble(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.leave_buddy_bubble(uuid, uuid, text) to service_role;

-- A member who leaves is no longer considered an active member when later joins are evaluated.
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
  perform pg_advisory_xact_lock(hashtextextended('buddy_pair:' || least(p_joiner::text, p_target::text) || ':' || greatest(p_joiner::text, p_target::text), 0));

  select b.id into v_bubble
  from public.buddy_bubbles b
  join public.buddy_bubble_members t on t.bubble_id = b.id and t.user_id = p_target and t.left_at is null
  join public.buddy_bubble_members j on j.bubble_id = b.id and j.user_id = p_joiner and j.left_at is null
  where b.closed_at is null and b.expires_at > now()
  order by b.created_at desc limit 1;
  if v_bubble is not null then return query select v_bubble, false, true; return; end if;

  for v_bubble in
    select b.id from public.buddy_bubbles b
    join public.buddy_bubble_members t on t.bubble_id = b.id and t.user_id = p_target and t.left_at is null
    where b.closed_at is null and b.expires_at > now()
      and not exists (
        select 1 from public.buddy_bubble_members o
        join public.buddy_blocks k on (k.user_id = o.user_id and k.blocked_user_id = p_joiner)
          or (k.user_id = p_joiner and k.blocked_user_id = o.user_id)
        where o.bubble_id = b.id and o.left_at is null
      )
    order by b.created_at desc, b.id
  loop
    select b.max_members into v_max from public.buddy_bubbles b
    where b.id = v_bubble and b.closed_at is null and b.expires_at > now() for update;
    if not found then continue; end if;
    select count(*) into v_count from public.buddy_bubble_members m where m.bubble_id = v_bubble and m.left_at is null;
    if v_count < v_max then
      insert into public.buddy_bubble_members (bubble_id, user_id, trip_id, left_at)
      values (v_bubble, p_joiner, p_joiner_trip, null)
      on conflict (bubble_id, user_id) do update set trip_id = excluded.trip_id, left_at = null;
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

revoke execute on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;