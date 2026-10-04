-- Buddies and biometric-verification records are private safety data. RLS is enabled
-- with no authenticated/anon policies; only the service-role API layer may access them.

create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected', 'suspended');
create type public.buddy_mode as enum ('walk', 'taxi', 'ehail', 'bus', 'train');
create type public.buddy_audience as enum ('all_verified', 'contacts_only');
create type public.buddy_ping_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.face_check_status as enum ('pending', 'passed', 'failed', 'expired', 'error');

alter table public.profiles
  add column if not exists verification_status public.verification_status not null default 'unverified',
  add column if not exists face_locked_until timestamptz;

create table public.user_enrolment (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  provider_reference text,
  provider_subject_id text,
  id_number_hash text,
  status public.verification_status not null default 'unverified',
  enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.buddy_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  alias text not null,
  avatar text not null,
  start_lat double precision not null check (start_lat between -90 and 90),
  start_lng double precision not null check (start_lng between -180 and 180),
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  route jsonb not null,
  mode public.buddy_mode not null,
  leave_from timestamptz not null,
  leave_to timestamptz not null,
  max_walk_m integer not null check (max_walk_m between 50 and 5000),
  max_group_size smallint not null default 3 check (max_group_size between 2 and 4),
  audience public.buddy_audience not null default 'all_verified',
  visible boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index buddy_trips_one_active_user on public.buddy_trips(user_id) where active;
create index buddy_trips_active_visibility on public.buddy_trips(active, visible, expires_at);

create table public.buddy_contacts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_user_id),
  check (user_id <> contact_user_id)
);

create table public.buddy_blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id),
  check (user_id <> blocked_user_id)
);

create table public.buddy_pings (
  id uuid primary key default gen_random_uuid(),
  from_trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  to_trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  status public.buddy_ping_status not null default 'pending',
  last_declined_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_trip_id <> to_trip_id)
);
create index buddy_pings_target_pending on public.buddy_pings(to_trip_id, status, created_at desc);

create table public.buddy_bubbles (
  id uuid primary key default gen_random_uuid(),
  meeting_code text not null,
  expected_meeting_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table public.buddy_bubble_members (
  bubble_id uuid not null references public.buddy_bubbles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  trip_id uuid references public.buddy_trips(id) on delete set null,
  share_first_name boolean not null default false,
  clothing_top_color text check (clothing_top_color in ('black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'grey', 'brown')),
  carrying_bag boolean,
  arrived_at timestamptz,
  met_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (bubble_id, user_id)
);

create table public.buddy_pair_states (
  viewer_trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  target_trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (viewer_trip_id, target_trip_id)
);
create table public.buddy_query_log (
  id bigint generated always as identity primary key,
  viewer_trip_id uuid not null references public.buddy_trips(id) on delete cascade,
  queried_at timestamptz not null default now(),
  snapped_lat double precision not null,
  snapped_lng double precision not null,
  refs jsonb not null,
  bands jsonb not null
);
create index buddy_query_log_recent on public.buddy_query_log(viewer_trip_id, queried_at desc);

create table public.buddy_privacy_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('home', 'work')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null check (radius_m between 50 and 2000),
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table public.safe_places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  opening_hours jsonb,
  lit_score numeric(3,2) not null default 0 check (lit_score between 0 and 1),
  busy_score numeric(3,2) not null default 0 check (busy_score between 0 and 1),
  cctv boolean not null default false,
  isolation_score numeric(3,2) not null default 1 check (isolation_score between 0 and 1),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  reverify_by date,
  active boolean not null default true,
  partner_contact text,
  notes text,
  updated_at timestamptz not null default now()
);
create table public.safe_place_audit (
  id bigint generated always as identity primary key,
  safe_place_id uuid references public.safe_places(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  changed_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

create table public.face_check_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_token_hash text not null,
  purpose text not null check (purpose in ('visibility', 'nearby', 'ping', 'bubble')),
  nonce text not null unique,
  status public.face_check_status not null default 'pending',
  provider_session_id text not null unique,
  provider_reference text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index face_check_sessions_lookup on public.face_check_sessions(user_id, device_token_hash, status, expires_at);
create table public.face_proofs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_token_hash text not null,
  session_id uuid not null unique references public.face_check_sessions(id) on delete cascade,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_token_hash)
);
create table public.face_check_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_token_hash text,
  purpose text not null,
  result text not null,
  provider_reference text,
  created_at timestamptz not null default now()
);
create index face_check_attempts_recent on public.face_check_attempts(user_id, created_at desc);
create table public.buddy_moderation_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

alter table public.user_enrolment enable row level security;
alter table public.buddy_trips enable row level security;
alter table public.buddy_contacts enable row level security;
alter table public.buddy_blocks enable row level security;
alter table public.buddy_pings enable row level security;
alter table public.buddy_bubbles enable row level security;
alter table public.buddy_bubble_members enable row level security;
alter table public.buddy_pair_states enable row level security;
alter table public.buddy_query_log enable row level security;
alter table public.buddy_privacy_zones enable row level security;
alter table public.safe_places enable row level security;
alter table public.safe_place_audit enable row level security;
alter table public.face_check_sessions enable row level security;
alter table public.face_proofs enable row level security;
alter table public.face_check_attempts enable row level security;
alter table public.buddy_moderation_flags enable row level security;

revoke all on public.user_enrolment, public.buddy_trips, public.buddy_contacts, public.buddy_blocks, public.buddy_pings, public.buddy_bubbles, public.buddy_bubble_members, public.buddy_pair_states, public.buddy_query_log, public.buddy_privacy_zones, public.safe_places, public.safe_place_audit, public.face_check_sessions, public.face_proofs, public.face_check_attempts, public.buddy_moderation_flags from anon, authenticated;