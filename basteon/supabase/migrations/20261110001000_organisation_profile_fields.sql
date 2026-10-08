-- Enrich organisation identity fields for onboarding and registration.

alter table public.organisations
  add column if not exists legal_name text,
  add column if not exists display_name text,
  add column if not exists description text,
  add column if not exists logo_url text,
  add column if not exists category text;

