begin;

create or replace function public.resolve_alert_for_responder(
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
  v_assignment_id uuid;
  v_responders uuid[];
begin
  select status into v_status
  from public.alerts
  where id = p_alert_id
  for update;
  if not found then raise exception 'not_found'; end if;
  if v_status in ('resolved', 'false_alarm') then raise exception 'closed_alert'; end if;

  select aa.id into v_assignment_id
  from public.alert_assignments aa
  join public.organisation_memberships m
    on m.user_id = aa.responder_user_id
   and m.organisation_id = aa.organisation_id
   and (m.branch_id is null or m.branch_id = aa.branch_id)
  where aa.alert_id = p_alert_id
    and aa.responder_user_id = p_actor_id
    and aa.status = 'on_scene'
    and m.status = 'active'
    and m.role in ('responder', 'dispatcher')
  for update of aa;
  if not found then raise exception 'forbidden'; end if;

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
  values (
    p_alert_id,
    p_actor_id,
    v_status,
    'resolved',
    coalesce(nullif(btrim(p_note), ''), 'Incident completed by an on-scene responder.')
  );
  return v_responders;
end;
$$;

revoke all on function public.resolve_alert_for_responder(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_alert_for_responder(uuid, uuid, text) to service_role;

commit;
