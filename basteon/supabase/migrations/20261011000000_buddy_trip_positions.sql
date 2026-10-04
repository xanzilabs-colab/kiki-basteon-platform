-- Exact Buddy positions remain service-role-only. They are used solely to build the
-- privacy-preserving engine view and are never sent to browser clients.
alter table public.buddy_trips
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists last_position_at timestamptz,
  add constraint buddy_trips_last_lat_range check (last_lat is null or last_lat between -90 and 90),
  add constraint buddy_trips_last_lng_range check (last_lng is null or last_lng between -180 and 180);

create index if not exists buddy_trips_recent_position on public.buddy_trips(active, visible, last_position_at desc);