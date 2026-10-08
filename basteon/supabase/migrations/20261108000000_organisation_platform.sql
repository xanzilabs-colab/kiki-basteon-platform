-- Organisation platform foundation
-- Supports organisation onboarding, branch segmentation, member linking, and responder accounts.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'organisation_type') then
    create type public.organisation_type as enum ('institution', 'business', 'responder_partner');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'organisation_status') then
    create type public.organisation_status as enum ('active', 'suspended', 'pending_review');
  end if;
end $$;

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  slug text not null unique,
  organisation_type public.organisation_type not null,
  institution_kind text,
  business_category text,
  responder_category text,
  status public.organisation_status not null default 'active',
  website text,
  support_email text,
  support_phone text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_link_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  allow_email_domain boolean not null default true,
  allow_work_id boolean not null default true,
  require_invite boolean not null default false,
  work_id_regex text,
  auto_approve_links boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_domains (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  domain text not null,
  membership_type text not null default 'general',
  role_hint text not null default 'member',
  priority smallint not null default 100,
  created_at timestamptz not null default now(),
  unique (organisation_id, lower(domain))
);

create table if not exists public.organisation_work_id_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  rule_name text not null,
  regex_pattern text not null,
  membership_type text not null default 'general',
  role_hint text not null default 'member',
  priority smallint not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.organisation_branches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  code text,
  address text,
  city text,
  lat double precision,
  lng double precision,
  geofence_geojson jsonb,
  is_hq boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table if not exists public.organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid references public.organisation_branches(id) on delete set null,
  membership_type text not null default 'general',
  role text not null default 'member',
  status text not null default 'active',
  source text not null default 'manual',
  linked_identifier text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create table if not exists public.organisation_user_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid references public.organisation_branches(id) on delete set null,
  label text not null default 'other',
  place_address text,
  method text not null,
  identifier text not null,
  membership_type text not null default 'general',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organisation_id, label)
);

create table if not exists public.organisation_emergency_coverage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid references public.organisation_branches(id) on delete cascade,
  emergency_type_code text not null references public.emergency_types(code) on delete cascade,
  priority smallint not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, branch_id, emergency_type_code)
);

create table if not exists public.organisation_onboarding (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  organisation_profile_done boolean not null default false,
  branches_done boolean not null default false,
  linking_rules_done boolean not null default false,
  coverage_done boolean not null default false,
  responders_done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text,
  work_id text,
  invite_code text not null unique,
  branch_id uuid references public.organisation_branches(id) on delete set null,
  membership_type text not null default 'general',
  role text not null default 'member',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (email is not null or work_id is not null)
);

create index if not exists organisations_type_idx on public.organisations (organisation_type);
create index if not exists organisations_status_idx on public.organisations (status);
create index if not exists organisation_branches_org_idx on public.organisation_branches (organisation_id);
create index if not exists organisation_memberships_user_idx on public.organisation_memberships (user_id);
create index if not exists organisation_memberships_org_idx on public.organisation_memberships (organisation_id);
create index if not exists organisation_user_links_user_idx on public.organisation_user_links (user_id);
create index if not exists organisation_user_links_org_idx on public.organisation_user_links (organisation_id);
create index if not exists organisation_coverage_org_idx on public.organisation_emergency_coverage (organisation_id);

create or replace function public.organisations_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_organisations_touch_updated_at on public.organisations;
create trigger trg_organisations_touch_updated_at
before update on public.organisations
for each row execute function public.organisations_touch_updated_at();

drop trigger if exists trg_organisation_branches_touch_updated_at on public.organisation_branches;
create trigger trg_organisation_branches_touch_updated_at
before update on public.organisation_branches
for each row execute function public.organisations_touch_updated_at();

drop trigger if exists trg_organisation_memberships_touch_updated_at on public.organisation_memberships;
create trigger trg_organisation_memberships_touch_updated_at
before update on public.organisation_memberships
for each row execute function public.organisations_touch_updated_at();

drop trigger if exists trg_organisation_user_links_touch_updated_at on public.organisation_user_links;
create trigger trg_organisation_user_links_touch_updated_at
before update on public.organisation_user_links
for each row execute function public.organisations_touch_updated_at();

drop trigger if exists trg_organisation_link_settings_touch_updated_at on public.organisation_link_settings;
create trigger trg_organisation_link_settings_touch_updated_at
before update on public.organisation_link_settings
for each row execute function public.organisations_touch_updated_at();

drop trigger if exists trg_organisation_onboarding_touch_updated_at on public.organisation_onboarding;
create trigger trg_organisation_onboarding_touch_updated_at
before update on public.organisation_onboarding
for each row execute function public.organisations_touch_updated_at();

alter table public.organisations enable row level security;
alter table public.organisation_link_settings enable row level security;
alter table public.organisation_domains enable row level security;
alter table public.organisation_work_id_rules enable row level security;
alter table public.organisation_branches enable row level security;
alter table public.organisation_memberships enable row level security;
alter table public.organisation_user_links enable row level security;
alter table public.organisation_emergency_coverage enable row level security;
alter table public.organisation_onboarding enable row level security;
alter table public.organisation_invites enable row level security;

drop policy if exists organisation_memberships_select_own on public.organisation_memberships;
create policy organisation_memberships_select_own on public.organisation_memberships
for select to authenticated
using (user_id = auth.uid());

drop policy if exists organisation_user_links_select_own on public.organisation_user_links;
create policy organisation_user_links_select_own on public.organisation_user_links
for select to authenticated
using (user_id = auth.uid());

drop policy if exists organisation_user_links_write_own on public.organisation_user_links;
create policy organisation_user_links_write_own on public.organisation_user_links
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
