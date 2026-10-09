drop index if exists public.alert_assignments_alert_active_idx;

create unique index if not exists alert_assignments_alert_responder_active_idx
on public.alert_assignments(alert_id, responder_user_id)
where responder_user_id is not null
  and status in ('assigned', 'acknowledged', 'en_route', 'on_scene');

drop policy if exists alert_assignments_write_visible on public.alert_assignments;
revoke insert, update, delete on public.alert_assignments from anon, authenticated;
grant select on public.alert_assignments to authenticated;

create table if not exists public.alert_assignment_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  assignment_id uuid references public.alert_assignments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in (
    'assigned', 'acknowledged', 'en_route', 'on_scene', 'withdrawn', 'cancelled', 'completed'
  )),
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);

create index if not exists alert_assignment_events_alert_idx
on public.alert_assignment_events(alert_id, created_at desc);

alter table public.alert_assignment_events enable row level security;
revoke all on public.alert_assignment_events from anon, authenticated;
grant select on public.alert_assignment_events to authenticated;

drop policy if exists alert_assignment_events_select_visible on public.alert_assignment_events;
create policy alert_assignment_events_select_visible on public.alert_assignment_events
for select to authenticated
using (public.can_access_alert(alert_id));

revoke update on public.alerts from anon, authenticated;
revoke insert, update, delete on public.alert_events from anon, authenticated;

create or replace function public.apply_alert_response(
  p_alert_id uuid,
  p_actor_id uuid,
  p_organisation_id uuid,
  p_branch_id uuid,
  p_action text,
  p_lat double precision default null,
  p_lng double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_status public.alert_status;
  v_assigned_to uuid;
  v_assignment_id uuid;
  v_from_status text;
  v_next_status text;
  v_aggregate_status public.alert_status;
begin
  if p_action not in ('accept', 'en_route', 'on_scene', 'withdraw', 'location') then
    raise exception 'invalid_action';
  end if;
  if p_branch_id is null then raise exception 'branch_required'; end if;

  if not exists (
    select 1
    from public.organisation_memberships m
    join public.alert_dispatch_targets t
      on t.organisation_id = m.organisation_id
     and (t.branch_id is null or t.branch_id = p_branch_id)
    where m.user_id = p_actor_id
      and m.organisation_id = p_organisation_id
      and m.branch_id is not distinct from (
        case when t.branch_id is null then m.branch_id else t.branch_id end
      )
      and m.status = 'active'
      and m.role in ('responder', 'dispatcher')
      and t.alert_id = p_alert_id
      and t.status in ('pending', 'accepted', 'escalated')
  ) then
    raise exception 'forbidden';
  end if;

  select a.status, a.assigned_to
  into v_alert_status, v_assigned_to
  from public.alerts a
  where a.id = p_alert_id
  for update;
  if not found then raise exception 'not_found'; end if;
  if v_alert_status in ('resolved', 'false_alarm') then raise exception 'closed_alert'; end if;

  if p_action = 'location' then
    if p_lat is null or p_lng is null
       or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
      raise exception 'invalid_location';
    end if;
    select aa.id, aa.status
    into v_assignment_id, v_from_status
    from public.alert_assignments aa
    where aa.alert_id = p_alert_id
      and aa.responder_user_id = p_actor_id
      and aa.organisation_id = p_organisation_id
      and aa.branch_id = p_branch_id
      and aa.status in ('acknowledged', 'en_route', 'on_scene')
    for update;
    if not found then raise exception 'response_not_accepted'; end if;

    insert into public.responder_presence (
      user_id, organisation_id, branch_id, availability, last_lat, last_lng, last_seen_at
    ) values (
      p_actor_id, p_organisation_id, p_branch_id,
      case when v_from_status = 'on_scene' then 'on_scene' else 'en_route' end,
      p_lat, p_lng, now()
    )
    on conflict (user_id) do update set
      organisation_id = excluded.organisation_id,
      branch_id = excluded.branch_id,
      availability = excluded.availability,
      last_lat = excluded.last_lat,
      last_lng = excluded.last_lng,
      last_seen_at = excluded.last_seen_at;
    return v_assignment_id;
  end if;

  select aa.id, aa.status
  into v_assignment_id, v_from_status
  from public.alert_assignments aa
  where aa.alert_id = p_alert_id
    and aa.responder_user_id = p_actor_id
    and aa.status in ('assigned', 'acknowledged', 'en_route', 'on_scene')
  for update;

  if p_action = 'accept' then
    if not found then
      insert into public.alert_assignments (
        alert_id, organisation_id, branch_id, responder_user_id, status, acknowledged_at
      ) values (
        p_alert_id, p_organisation_id, p_branch_id, p_actor_id, 'acknowledged', now()
      )
      returning id into v_assignment_id;
      v_from_status := null;
      v_next_status := 'acknowledged';
    else
      v_next_status := case when v_from_status = 'assigned' then 'acknowledged' else v_from_status end;
    end if;
  elsif p_action = 'withdraw' then
    if not found then raise exception 'response_not_accepted'; end if;
    v_next_status := 'cancelled';
  else
    if not found or v_from_status not in ('acknowledged', 'en_route', 'on_scene') then
      raise exception 'response_not_accepted';
    end if;
    v_next_status := case
      when p_action = 'en_route' and v_from_status = 'on_scene' then 'on_scene'
      else p_action
    end;
  end if;

  if v_from_status is not null then
    update public.alert_assignments
    set status = v_next_status,
        acknowledged_at = case when v_next_status = 'acknowledged' then coalesce(acknowledged_at, now()) else acknowledged_at end,
        completed_at = case when v_next_status = 'cancelled' then now() else null end
    where id = v_assignment_id;
  end if;

  insert into public.alert_assignment_events (
    alert_id, assignment_id, actor_id, action, from_status, to_status
  ) values (
    p_alert_id, v_assignment_id, p_actor_id,
    case when p_action = 'accept' then 'acknowledged'
         when p_action = 'withdraw' then 'withdrawn'
         else p_action end,
    v_from_status, v_next_status
  );

  if p_action = 'accept' then
    update public.alert_dispatch_targets
    set status = 'accepted'
    where alert_id = p_alert_id
      and organisation_id = p_organisation_id
      and (branch_id is null or branch_id = p_branch_id);
  end if;

  select case
    when exists (select 1 from public.alert_assignments where alert_id = p_alert_id and status = 'on_scene') then 'on_scene'::public.alert_status
    when exists (select 1 from public.alert_assignments where alert_id = p_alert_id and status = 'en_route') then 'enroute'::public.alert_status
    when exists (select 1 from public.alert_assignments where alert_id = p_alert_id and status = 'acknowledged') then 'acknowledged'::public.alert_status
    else 'new'::public.alert_status
  end into v_aggregate_status;

  update public.alerts
  set status = v_aggregate_status,
      assigned_to = (
        select responder_user_id from public.alert_assignments
        where alert_id = p_alert_id and status in ('acknowledged', 'en_route', 'on_scene')
        order by assigned_at limit 1
      )
  where id = p_alert_id
    ;

  return v_assignment_id;
end;
$$;

create or replace function public.cancel_sos_as_false_alarm(p_alert_id uuid, p_actor_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.alert_status;
  v_device_owner uuid;
  v_responders uuid[];
  v_now timestamptz := now();
begin
  select a.status, d.user_id
  into v_status, v_device_owner
  from public.alerts a
  join public.devices d on d.device_id = a.device_id
  where a.id = p_alert_id
  for update of a;
  if not found then raise exception 'not_found'; end if;
  if v_device_owner is distinct from p_actor_id then raise exception 'forbidden'; end if;
  if v_status = 'resolved' then raise exception 'alert_already_resolved'; end if;
  if v_status = 'false_alarm' then return '{}'::uuid[]; end if;

  with active as materialized (
    select id, responder_user_id, status
    from public.alert_assignments
    where alert_id = p_alert_id
      and status in ('assigned', 'acknowledged', 'en_route', 'on_scene')
    for update
  ), closed as (
    update public.alert_assignments aa
    set status = 'cancelled', completed_at = v_now
    from active a
    where aa.id = a.id
    returning aa.id, aa.responder_user_id
  ), logged as (
    insert into public.alert_assignment_events (
      alert_id, assignment_id, actor_id, action, from_status, to_status
    )
    select p_alert_id, c.id, p_actor_id, 'cancelled', a.status, 'cancelled'
    from closed c
    join active a on a.id = c.id
    returning id
  )
  select coalesce(array_agg(distinct c.responder_user_id) filter (where c.responder_user_id is not null), '{}'::uuid[])
  into v_responders
  from closed c;

  update public.alerts set status = 'false_alarm' where id = p_alert_id;
  insert into public.alert_events (alert_id, actor_id, from_status, to_status, note)
  values (p_alert_id, p_actor_id, v_status, 'false_alarm', 'Caller reported a false alarm and cancelled the alert.');
  return v_responders;
end;
$$;

create or replace function public.resolve_alert_for_operations(
  p_alert_id uuid,
  p_actor_id uuid,
  p_note text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.alert_status;
  v_responders uuid[];
begin
  select status into v_status from public.alerts where id = p_alert_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_status in ('resolved', 'false_alarm') then raise exception 'closed_alert'; end if;
  if not exists (
    select 1
    from public.organisation_memberships m
    join public.alert_dispatch_targets t
      on t.organisation_id = m.organisation_id
     and (t.branch_id is null or m.branch_id is null or t.branch_id = m.branch_id)
    where m.user_id = p_actor_id
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
      and t.alert_id = p_alert_id
  ) then raise exception 'forbidden'; end if;

  with active as materialized (
    select id, responder_user_id, status
    from public.alert_assignments
    where alert_id = p_alert_id
      and status in ('assigned', 'acknowledged', 'en_route', 'on_scene')
    for update
  ), closed as (
    update public.alert_assignments aa
    set status = 'completed', completed_at = now()
    from active a
    where aa.id = a.id
    returning aa.id, aa.responder_user_id
  ), logged as (
    insert into public.alert_assignment_events (
      alert_id, assignment_id, actor_id, action, from_status, to_status
    )
    select p_alert_id, c.id, p_actor_id, 'completed', a.status, 'completed'
    from closed c
    join active a on a.id = c.id
    returning id
  )
  select coalesce(array_agg(distinct c.responder_user_id) filter (where c.responder_user_id is not null), '{}'::uuid[])
  into v_responders
  from closed c;

  update public.alerts set status = 'resolved' where id = p_alert_id;
  insert into public.alert_events (alert_id, actor_id, from_status, to_status, note)
  values (p_alert_id, p_actor_id, v_status, 'resolved', coalesce(nullif(btrim(p_note), ''), 'Incident closed by organisation operations.'));
  return v_responders;
end;
$$;

revoke all on function public.apply_alert_response(uuid, uuid, uuid, uuid, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.cancel_sos_as_false_alarm(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_alert_for_operations(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_alert_response(uuid, uuid, uuid, uuid, text, double precision, double precision) to service_role;
grant execute on function public.cancel_sos_as_false_alarm(uuid, uuid) to service_role;
grant execute on function public.resolve_alert_for_operations(uuid, uuid, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'alert_assignments'
     ) then
    alter publication supabase_realtime add table public.alert_assignments;
  end if;
end
$$;
