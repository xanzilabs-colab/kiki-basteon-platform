-- Organisation account controls and support contacts

alter table public.organisations
  add column if not exists blocked_until timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists blocked_by uuid references public.profiles(id) on delete set null;

create index if not exists organisations_blocked_until_idx on public.organisations (blocked_until);

create table if not exists public.support_contacts (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'organisation')),
  organisation_id uuid references public.organisations(id) on delete cascade,
  contact_name text not null check (length(trim(contact_name)) >= 2),
  contact_type text not null check (contact_type in ('email', 'phone')),
  contact_value text not null check (length(trim(contact_value)) >= 3),
  purpose text not null default 'general support',
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'global' and organisation_id is null) or (scope = 'organisation' and organisation_id is not null))
);

create index if not exists support_contacts_scope_idx on public.support_contacts (scope, active);
create index if not exists support_contacts_org_idx on public.support_contacts (organisation_id, active);
create index if not exists support_contacts_purpose_idx on public.support_contacts (purpose);

drop trigger if exists trg_support_contacts_touch_updated_at on public.support_contacts;
create trigger trg_support_contacts_touch_updated_at
before update on public.support_contacts
for each row execute function public.organisations_touch_updated_at();
