-- Organisation roster + roster-only link validation foundation

alter table public.organisation_link_settings
  add column if not exists require_identifier_verification boolean not null default false,
  add column if not exists roster_id_case_mode text not null default 'upper' check (roster_id_case_mode in ('upper', 'lower', 'as_is')),
  add column if not exists roster_grace_days integer not null default 14 check (roster_grace_days between 0 and 90);

alter table public.organisations
  add column if not exists is_partner boolean not null default false;

update public.organisations
set is_partner = true
where organisation_type = 'responder_partner' and is_partner = false;

create table if not exists public.org_roster_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  file_name text,
  file_type text,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'failed', 'cancelled')),
  mode text not null default 'add_only' check (mode in ('add_only', 'full_sync')),
  detected_mapping jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table if not exists public.org_roster_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  membership_type text not null default 'member',
  identifier_type text not null check (identifier_type in ('email', 'member_id', 'access_code')),
  identifier_raw text not null,
  identifier_normalized text not null,
  display_name text,
  status text not null default 'active' check (status in ('active', 'suspended', 'expired', 'removed')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  source text not null default 'manual' check (source in ('csv', 'spreadsheet', 'pasted', 'manual', 'generated')),
  import_id uuid references public.org_roster_imports(id) on delete set null,
  claimed_by_user_id uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  max_claims integer not null default 1 check (max_claims >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, identifier_type, identifier_normalized)
);

create index if not exists org_roster_entries_lookup_idx
  on public.org_roster_entries (org_id, identifier_type, identifier_normalized);
create index if not exists org_roster_entries_status_idx
  on public.org_roster_entries (org_id, status);

create table if not exists public.org_roster_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entry_id uuid references public.org_roster_entries(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists org_roster_audit_org_created_idx
  on public.org_roster_audit_log (org_id, created_at desc);

create table if not exists public.org_link_validation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  org_id uuid references public.organisations(id) on delete set null,
  ip_hash text,
  identifier_type text,
  success boolean not null default false,
  reason_code text,
  created_at timestamptz not null default now()
);

create index if not exists org_link_validation_attempts_user_idx
  on public.org_link_validation_attempts (user_id, created_at desc);
create index if not exists org_link_validation_attempts_ip_idx
  on public.org_link_validation_attempts (ip_hash, created_at desc);

alter table public.organisation_memberships
  add column if not exists roster_entry_id uuid references public.org_roster_entries(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text,
  add column if not exists last_revalidated_at timestamptz;

alter table public.organisation_user_links
  add column if not exists roster_entry_id uuid references public.org_roster_entries(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_method text;

alter table public.org_roster_entries enable row level security;
alter table public.org_roster_imports enable row level security;
alter table public.org_roster_audit_log enable row level security;
alter table public.org_link_validation_attempts enable row level security;

drop policy if exists org_roster_entries_select_privileged on public.org_roster_entries;
create policy org_roster_entries_select_privileged on public.org_roster_entries
for select to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_entries.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists org_roster_entries_write_privileged on public.org_roster_entries;
create policy org_roster_entries_write_privileged on public.org_roster_entries
for all to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_entries.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
)
with check (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_entries.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists org_roster_imports_select_privileged on public.org_roster_imports;
create policy org_roster_imports_select_privileged on public.org_roster_imports
for select to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_imports.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists org_roster_imports_write_privileged on public.org_roster_imports;
create policy org_roster_imports_write_privileged on public.org_roster_imports
for all to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_imports.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
)
with check (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_imports.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists org_roster_audit_log_select_privileged on public.org_roster_audit_log;
create policy org_roster_audit_log_select_privileged on public.org_roster_audit_log
for select to authenticated
using (
  exists (
    select 1 from public.organisation_memberships m
    where m.organisation_id = org_roster_audit_log.org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

drop trigger if exists trg_org_roster_entries_touch_updated_at on public.org_roster_entries;
create trigger trg_org_roster_entries_touch_updated_at
before update on public.org_roster_entries
for each row execute function public.organisations_touch_updated_at();
