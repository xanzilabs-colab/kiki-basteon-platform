create table if not exists public.user_intelligence_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  learning_enabled boolean not null default false,
  missed_checkin_enabled boolean not null default false,
  route_hints_enabled boolean not null default false,
  share_hints_with_buddies boolean not null default false,
  buddy_hints_enabled boolean not null default false,
  guardian_notify_enabled boolean not null default false,
  hint_notifications_enabled boolean not null default false,
  escalation_delay_minutes integer not null default 3 check (escalation_delay_minutes between 1 and 30),
  quiet_hours jsonb not null default '{"enabled":false,"start":"22:00","end":"07:00"}'::jsonb,
  retention_days integer not null default 90 check (retention_days between 30 and 365),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pattern_key text not null,
  mode text not null check (mode in ('taxi', 'walk')),
  day_type text not null check (day_type in ('weekday', 'weekend')),
  time_bucket smallint not null check (time_bucket between 0 and 11),
  sample_count integer not null default 0 check (sample_count >= 0),
  duration_p50 integer not null check (duration_p50 >= 0),
  duration_p80 integer not null check (duration_p80 >= 0),
  duration_p95 integer not null check (duration_p95 >= 0),
  arrival_window_start timestamptz,
  arrival_window_end timestamptz,
  durations_seconds integer[] not null default '{}',
  last_updated timestamptz not null default now(),
  unique (user_id, pattern_key, mode, day_type, time_bucket)
);
create index if not exists trip_patterns_owner_updated_idx on public.trip_patterns(user_id, last_updated desc);

create table if not exists public.checkin_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage text not null check (stage in ('due_soon', 'nudge', 'countdown', 'guardian_notified', 'help_offered', 'resolved')),
  reason jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  response text check (response in ('ok', 'need_more_time', 'help', 'none')),
  countdown_until timestamptz,
  extension_minutes smallint check (extension_minutes is null or extension_minutes in (10, 20, 30)),
  updated_at timestamptz not null default now()
);
create index if not exists checkin_events_user_recent_idx on public.checkin_events(user_id, sent_at desc);

create table if not exists public.risk_cells (
  cell_id text not null,
  time_bucket smallint not null check (time_bucket between 0 and 11),
  day_type text not null check (day_type in ('weekday', 'weekend')),
  report_count integer not null default 0 check (report_count >= 0),
  distinct_reporters integer not null default 0 check (distinct_reporters >= 0),
  weighted_score numeric(7,3) not null default 0 check (weighted_score >= 0),
  safe_spot_density numeric(7,3) not null default 0 check (safe_spot_density >= 0),
  last_computed timestamptz not null default now(),
  primary key (cell_id, time_bucket, day_type)
);
alter table public.risk_cells enable row level security;
revoke all on public.risk_cells from anon, authenticated;

create table if not exists public.safety_hints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  audience text not null check (audience in ('self', 'buddies', 'area')),
  trip_id uuid references public.trips(id) on delete cascade,
  cell_id text,
  hint_type text not null check (hint_type in ('avoid_time', 'alternative_route', 'stay_visible', 'safe_spot_nearby', 'check_in_suggested')),
  message text not null check (char_length(message) between 1 and 240),
  reason jsonb not null default '{}'::jsonb,
  severity text not null check (severity in ('info', 'caution')),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  dismissed_at timestamptz,
  helpful boolean
);
create index if not exists safety_hints_user_recent_idx on public.safety_hints(user_id, created_at desc) where user_id is not null;

create table if not exists public.intelligence_demo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'active', 'resolved')),
  stage text not null default 'ready' check (stage in ('ready', 'due_soon', 'nudge', 'countdown', 'resolved')),
  simulated_started_at timestamptz not null default now(),
  simulated_expected_at timestamptz not null default now() + interval '12 minutes',
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intelligence_demo_user_idx on public.intelligence_demo_sessions(user_id, created_at desc);

create table if not exists public.intelligence_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, action_key)
);
alter table public.intelligence_rate_limits enable row level security;
revoke all on public.intelligence_rate_limits from anon, authenticated;

create or replace function public.consume_intelligence_limit(
  p_user_id uuid,
  p_action_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now(); v_row public.intelligence_rate_limits%rowtype;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_action_key) not between 1 and 80 then
    raise exception 'invalid_rate_limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_action_key, 0));
  select * into v_row from public.intelligence_rate_limits
    where user_id = p_user_id and action_key = p_action_key for update;
  if not found then
    insert into public.intelligence_rate_limits(user_id, action_key, window_started_at, request_count)
      values (p_user_id, p_action_key, v_now, 1);
    return true;
  end if;
  if v_row.window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    update public.intelligence_rate_limits set window_started_at = v_now, request_count = 1
      where user_id = p_user_id and action_key = p_action_key;
    return true;
  end if;
  if v_row.request_count >= p_limit then return false; end if;
  update public.intelligence_rate_limits set request_count = request_count + 1
    where user_id = p_user_id and action_key = p_action_key;
  return true;
end $$;
revoke all on function public.consume_intelligence_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_intelligence_limit(uuid, text, integer, integer) to service_role;

alter table public.trips
  add column if not exists intelligence_pattern_key text,
  add column if not exists intelligence_day_type text check (intelligence_day_type is null or intelligence_day_type in ('weekday', 'weekend')),
  add column if not exists intelligence_time_bucket smallint check (intelligence_time_bucket is null or intelligence_time_bucket between 0 and 11),
  add column if not exists intelligence_reason jsonb not null default '{}'::jsonb,
  add column if not exists intelligence_confidence numeric(4,3) not null default 0 check (intelligence_confidence between 0 and 1);

alter table public.user_intelligence_settings enable row level security;
alter table public.trip_patterns enable row level security;
alter table public.checkin_events enable row level security;
alter table public.safety_hints enable row level security;
alter table public.intelligence_demo_sessions enable row level security;

drop policy if exists user_intelligence_settings_owner_select on public.user_intelligence_settings;
create policy user_intelligence_settings_owner_select on public.user_intelligence_settings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists user_intelligence_settings_owner_update on public.user_intelligence_settings;
create policy user_intelligence_settings_owner_update on public.user_intelligence_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists trip_patterns_owner_select on public.trip_patterns;
create policy trip_patterns_owner_select on public.trip_patterns
  for select to authenticated using (user_id = auth.uid());
drop policy if exists checkin_events_owner_select on public.checkin_events;
create policy checkin_events_owner_select on public.checkin_events
  for select to authenticated using (user_id = auth.uid());
drop policy if exists safety_hints_owner_select on public.safety_hints;
create policy safety_hints_owner_select on public.safety_hints
  for select to authenticated using (user_id = auth.uid());
drop policy if exists intelligence_demo_sessions_owner_all on public.intelligence_demo_sessions;
create policy intelligence_demo_sessions_owner_all on public.intelligence_demo_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.user_intelligence_settings to authenticated;
grant select on public.trip_patterns, public.checkin_events, public.safety_hints to authenticated;
grant select, insert, update, delete on public.intelligence_demo_sessions to authenticated;
