-- Alert routing, branch/org responder visibility, and escalation-ready dispatch targets.

insert into public.emergency_types (code, label, short_label, icon, tone, life_threat, sort_order, active)
values ('general', 'General emergency', 'General', 'siren', 'danger', true, 0, true)
on conflict (code) do update
set label = excluded.label,
    short_label = excluded.short_label,
    icon = excluded.icon,
    tone = excluded.tone,
    life_threat = excluded.life_threat,
    sort_order = excluded.sort_order,
    active = excluded.active;

update public.emergency_types set active = false where code = 'sos';
update public.alerts set type_code = 'general' where type_code = 'sos';

create or replace function public.resolve_emergency_type(p_type text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select t.code
      from public.emergency_types t
      where t.active
        and t.code = case
          when lower(coalesce(btrim(p_type), '')) in ('', 'sos') then 'general'
          else lower(btrim(p_type))
        end
    ),
    'general'
  )
$$;

create table if not exists public.alert_dispatch_targets (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid references public.organisation_branches(id) on delete set null,
  emergency_type_code text not null references public.emergency_types(code) on delete restrict,
  tier smallint not null check (tier between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'escalated', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists alert_dispatch_targets_unique_idx
on public.alert_dispatch_targets (alert_id, organisation_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), tier);

create index if not exists alert_dispatch_targets_alert_idx
on public.alert_dispatch_targets (alert_id, tier, created_at);

create index if not exists alert_dispatch_targets_org_branch_idx
on public.alert_dispatch_targets (organisation_id, branch_id, status);

create table if not exists public.alert_routing_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  stage text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists alert_routing_events_alert_idx
on public.alert_routing_events (alert_id, created_at);

alter table public.alerts
  add column if not exists primary_organisation_id uuid references public.organisations(id) on delete set null,
  add column if not exists primary_branch_id uuid references public.organisation_branches(id) on delete set null,
  add column if not exists routed_at timestamptz,
  add column if not exists routing_status text not null default 'pending'
    check (routing_status in ('pending', 'routed', 'no_target', 'failed'));

create index if not exists alerts_routing_status_idx on public.alerts (routing_status, triggered_at desc);
create index if not exists alerts_primary_org_idx on public.alerts (primary_organisation_id, primary_branch_id);

create or replace function public.alert_dispatch_targets_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_alert_dispatch_targets_touch_updated_at on public.alert_dispatch_targets;
create trigger trg_alert_dispatch_targets_touch_updated_at
before update on public.alert_dispatch_targets
for each row execute function public.alert_dispatch_targets_touch_updated_at();

create or replace function public.can_access_alert(p_alert uuid, p_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if p_user is null then return false; end if;

  select role into v_role from public.profiles where id = p_user;
  if v_role = 'admin' then return true; end if;

  if exists (
    select 1
    from public.alerts a
    join public.devices d on d.device_id = a.device_id
    where a.id = p_alert and d.user_id = p_user
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.alert_dispatch_targets t
    join public.organisation_memberships m
      on m.organisation_id = t.organisation_id
     and m.user_id = p_user
     and m.status = 'active'
     and m.role in ('owner', 'admin', 'manager', 'dispatcher', 'responder', 'viewer')
    where t.alert_id = p_alert
      and (t.branch_id is null or m.branch_id is null or m.branch_id = t.branch_id)
  ) then
    return true;
  end if;

  return false;
end;
$$;

alter table public.alert_dispatch_targets enable row level security;
alter table public.alert_routing_events enable row level security;

drop policy if exists alert_dispatch_targets_select_visible on public.alert_dispatch_targets;
create policy alert_dispatch_targets_select_visible on public.alert_dispatch_targets
for select to authenticated
using (public.can_access_alert(alert_id));

drop policy if exists alert_dispatch_targets_staff_write on public.alert_dispatch_targets;
create policy alert_dispatch_targets_staff_write on public.alert_dispatch_targets
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists alert_routing_events_select_visible on public.alert_routing_events;
create policy alert_routing_events_select_visible on public.alert_routing_events
for select to authenticated
using (public.can_access_alert(alert_id));

drop policy if exists alert_routing_events_staff_write on public.alert_routing_events;
create policy alert_routing_events_staff_write on public.alert_routing_events
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
using (public.can_access_alert(id));

drop policy if exists alerts_staff_update on public.alerts;
create policy alerts_staff_update on public.alerts for update to authenticated
using (public.can_access_alert(id) and public.app_role() in ('admin', 'responder'))
with check (public.can_access_alert(id) and public.app_role() in ('admin', 'responder'));

drop policy if exists alert_events_select on public.alert_events;
create policy alert_events_select on public.alert_events for select to authenticated
using (public.can_access_alert(alert_id));

drop policy if exists alert_events_staff_insert on public.alert_events;
create policy alert_events_staff_insert on public.alert_events for insert to authenticated
with check (
  actor_id = auth.uid()
  and public.can_access_alert(alert_id)
  and public.app_role() in ('admin', 'responder')
);
