create table public.calm_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_history boolean not null default false,
  haptics boolean not null default true,
  sound boolean not null default true,
  breath_pace text not null default 'gentle' check (breath_pace in ('gentle','standard')),
  breath_holds boolean not null default false,
  baseline_level smallint not null default 1 check (baseline_level between 1 and 3),
  updated_at timestamptz not null default now()
);

create table public.calm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null check (tool in ('winds','baseline','body')),
  mode text,
  started_at timestamptz not null default now(),
  duration_s int not null default 0 check (duration_s between 0 and 3600),
  completed boolean not null default false,
  rating_before smallint check (rating_before between 1 and 5),
  rating_after smallint check (rating_after between 1 and 5),
  payload jsonb not null default '{}'
);
create index calm_sessions_user_idx on public.calm_sessions (user_id, started_at desc);

create table public.calm_trivia (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  options jsonb not null,
  answer smallint not null check (answer between 0 and 2),
  fact text not null,
  topic text,
  review_status text not null default 'draft' check (review_status in ('draft','reviewed','retired')),
  reviewed_by text,
  reviewed_at timestamptz,
  constraint calm_trivia_reviewed check (review_status <> 'reviewed' or (reviewed_by is not null and reviewed_at is not null))
);

do $$
declare t text;
begin
  foreach t in array array['calm_settings','calm_sessions','calm_trivia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function public.calm_cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.calm_sessions where started_at < now() - interval '90 days';
$$;
revoke all on function public.calm_cleanup() from public, anon, authenticated;
grant execute on function public.calm_cleanup() to service_role;

create or replace function public.calm_delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calm_sessions where user_id = p_user_id;
  delete from public.calm_settings where user_id = p_user_id;
end;
$$;
revoke all on function public.calm_delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.calm_delete_user_data(uuid) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'calm-cleanup') then
    perform cron.schedule('calm-cleanup', '17 3 * * *', 'select public.calm_cleanup()');
  end if;
end $$;
