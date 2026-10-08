-- Responder units, availability presence, and escalation policy primitives.

create table if not exists public.organisation_dispatch_policies (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  acknowledge_timeout_seconds integer not null default 45 check (acknowledge_timeout_seconds between 10 and 900),
  escalation_timeout_seconds integer not null default 120 check (escalation_timeout_seconds between 30 and 3600),
  auto_assign_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_units (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid not null references public.organisation_branches(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
  unit_type text not null default 'other',
  capability_codes text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, branch_id, name)
);

create table if not exists public.responder_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid not null references public.organisation_branches(id) on delete cascade,
  unit_id uuid references public.organisation_units(id) on delete set null,
  availability text not null default 'off_duty'
    check (availability in ('available', 'en_route', 'on_scene', 'busy', 'off_duty', 'unavailable')),
  capability_codes text[] not null default '{}',
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz not null default now(),
  current_alert_id uuid references public.alerts(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (last_lat is null or last_lat between -90 and 90),
  check (last_lng is null or last_lng between -180 and 180)
);

create table if not exists public.alert_assignments (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid not null references public.organisation_branches(id) on delete cascade,
  responder_user_id uuid references public.profiles(id) on delete set null,
  unit_id uuid references public.organisation_units(id) on delete set null,
  status text not null default 'assigned'
    check (status in ('assigned', 'acknowledged', 'en_route', 'on_scene', 'completed', 'escalated', 'cancelled')),
  assigned_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists alert_assignments_alert_active_idx
on public.alert_assignments(alert_id)
where status in ('assigned', 'acknowledged', 'en_route', 'on_scene');

create index if not exists organisation_units_org_branch_idx on public.organisation_units(organisation_id, branch_id, active);
create index if not exists responder_presence_org_branch_idx on public.responder_presence(organisation_id, branch_id, availability);
create index if not exists alert_assignments_alert_idx on public.alert_assignments(alert_id, assigned_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organisation_dispatch_policies_touch on public.organisation_dispatch_policies;
create trigger trg_organisation_dispatch_policies_touch
before update on public.organisation_dispatch_policies
for each row execute function public.touch_updated_at();

drop trigger if exists trg_organisation_units_touch on public.organisation_units;
create trigger trg_organisation_units_touch
before update on public.organisation_units
for each row execute function public.touch_updated_at();

drop trigger if exists trg_responder_presence_touch on public.responder_presence;
create trigger trg_responder_presence_touch
before update on public.responder_presence
for each row execute function public.touch_updated_at();

create or replace function public.require_branch_for_responder_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role in ('responder', 'dispatcher') and new.branch_id is null then
    raise exception 'Responders and dispatchers must belong to a branch.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_membership_branch_required on public.organisation_memberships;
create trigger trg_membership_branch_required
before insert or update on public.organisation_memberships
for each row execute function public.require_branch_for_responder_membership();

alter table public.organisation_dispatch_policies enable row level security;
alter table public.organisation_units enable row level security;
alter table public.responder_presence enable row level security;
alter table public.alert_assignments enable row level security;

drop policy if exists organisation_units_select_visible on public.organisation_units;
create policy organisation_units_select_visible on public.organisation_units
for select to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = organisation_units.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

drop policy if exists organisation_units_manage_privileged on public.organisation_units;
create policy organisation_units_manage_privileged on public.organisation_units
for all to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = organisation_units.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
  )
)
with check (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = organisation_units.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
  )
);

drop policy if exists responder_presence_select_visible on public.responder_presence;
create policy responder_presence_select_visible on public.responder_presence
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = responder_presence.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
  )
);

drop policy if exists responder_presence_manage_self_or_privileged on public.responder_presence;
create policy responder_presence_manage_self_or_privileged on public.responder_presence
for all to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = responder_presence.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = responder_presence.organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager', 'dispatcher')
  )
);

drop policy if exists alert_assignments_select_visible on public.alert_assignments;
create policy alert_assignments_select_visible on public.alert_assignments
for select to authenticated
using (public.can_access_alert(alert_id));

drop policy if exists alert_assignments_write_visible on public.alert_assignments;
create policy alert_assignments_write_visible on public.alert_assignments
for all to authenticated
using (
  public.can_access_alert(alert_id)
  and public.app_role() in ('admin', 'responder')
)
with check (
  public.can_access_alert(alert_id)
  and public.app_role() in ('admin', 'responder')
);

