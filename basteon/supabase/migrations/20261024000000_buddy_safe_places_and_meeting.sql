begin;

alter table public.safe_places
  add column category text not null default 'other_public',
  add column address text,
  add column suburb text,
  add column open_now boolean,
  add column open_24h boolean not null default false,
  add column quality integer not null default 3 check (quality between 1 and 5),
  add column review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  add column suggested_by uuid references public.profiles(id) on delete set null,
  add constraint safe_places_category_check check (category in ('petrol_station', 'mall', 'police_station', 'hospital', 'cafe_restaurant', 'transit_hub', 'other_public', 'supermarket', 'school', 'place_of_worship', 'bus_stop', 'taxi_rank'));
update public.safe_places set category = case when kind in ('petrol_station', 'mall', 'police_station', 'hospital', 'cafe_restaurant', 'transit_hub', 'supermarket', 'school', 'place_of_worship', 'bus_stop', 'taxi_rank') then kind else 'other_public' end,
  review_status = case when verified_at is not null then 'approved' else 'pending' end;

create table public.buddy_community_alerts (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('unsafe_area', 'poor_lighting', 'harassment', 'road_hazard')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '4 hours',
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index buddy_community_alerts_live on public.buddy_community_alerts(expires_at) where resolved_at is null;

create table public.buddy_bubble_meeting_locations (
  bubble_id uuid not null references public.buddy_bubbles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  allow_landmarks boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (bubble_id, user_id)
);
create table public.buddy_bubble_meetings (
  bubble_id uuid primary key references public.buddy_bubbles(id) on delete cascade,
  round integer not null default 0,
  selected_candidate_id uuid,
  generated_at timestamptz,
  generation_requested_at timestamptz,
  member_ids uuid[] not null default '{}'
);
create table public.buddy_bubble_spot_candidates (
  id uuid primary key default gen_random_uuid(),
  bubble_id uuid not null references public.buddy_bubbles(id) on delete cascade,
  round integer not null,
  source text not null check (source in ('curated', 'landmark')),
  spot_id uuid references public.safe_places(id) on delete set null,
  osm_ref text,
  name text not null check (length(name) between 1 and 200),
  category text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  address text,
  score double precision not null check (score between 0 and 100),
  dist_m jsonb not null,
  max_dist_m double precision not null check (max_dist_m >= 0),
  balanced boolean not null,
  unique (bubble_id, round, id)
);
alter table public.buddy_bubble_meetings add constraint buddy_meeting_selected_fk
  foreign key (bubble_id, round, selected_candidate_id) references public.buddy_bubble_spot_candidates(bubble_id, round, id);
create table public.buddy_bubble_spot_votes (
  bubble_id uuid not null,
  round integer not null,
  candidate_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (bubble_id, round, user_id),
  foreign key (bubble_id, round, candidate_id) references public.buddy_bubble_spot_candidates(bubble_id, round, id) on delete cascade
);
create table public.buddy_bubble_spot_feedback (
  bubble_id uuid not null,
  candidate_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('too_far', 'closed', 'unsafe', 'not_suitable')),
  created_at timestamptz not null default now(),
  primary key (bubble_id, candidate_id, user_id),
  foreign key (candidate_id) references public.buddy_bubble_spot_candidates(id) on delete cascade,
  foreign key (bubble_id) references public.buddy_bubbles(id) on delete cascade
);
alter table public.buddy_community_alerts enable row level security;
alter table public.buddy_bubble_meeting_locations enable row level security;
alter table public.buddy_bubble_meetings enable row level security;
alter table public.buddy_bubble_spot_candidates enable row level security;
alter table public.buddy_bubble_spot_votes enable row level security;
alter table public.buddy_bubble_spot_feedback enable row level security;
revoke all on public.buddy_community_alerts, public.buddy_bubble_meeting_locations, public.buddy_bubble_meetings,
  public.buddy_bubble_spot_candidates, public.buddy_bubble_spot_votes, public.buddy_bubble_spot_feedback from anon, authenticated;

alter table public.buddy_audit_events drop constraint buddy_audit_events_event_check;
alter table public.buddy_audit_events add constraint buddy_audit_events_event_check check (event in (
  'trip_created', 'bubble_created', 'member_joined', 'quick_update', 'meeting_confirmed',
  'virtual_walk_started', 'virtual_walk_answered', 'virtual_walk_ended', 'safety_reported',
  'buddy_blocked', 'member_left', 'bubble_closed', 'spot_options_generated', 'spot_voted',
  'spot_selected', 'spot_feedback', 'look_for_updated', 'safe_place_suggested', 'community_alert_reported'
));

create function public.buddy_require_account(p_admin boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_user and
    ((p_admin and role = 'admin') or (not p_admin and role = 'user' and verification_status <> 'suspended')))
  then raise exception 'forbidden'; end if;
  return v_user;
end; $$;

create function public.buddy_require_meeting_member(p_bubble_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.buddy_bubbles where id = p_bubble_id and closed_at is null and expires_at > now() for update;
  if not found or not exists (select 1 from public.buddy_bubble_members m join public.profiles p on p.id = m.user_id
    where m.bubble_id = p_bubble_id and m.user_id = p_user_id and m.left_at is null and p.role = 'user' and p.verification_status <> 'suspended')
  then raise exception 'not_member'; end if;
end; $$;

create function public.list_meetup_candidates_near(p_lat double precision, p_lng double precision, p_radius_m integer default 3000)
returns table(id uuid, name text, category text, lat double precision, lng double precision, address text, suburb text, open_now boolean, open_24h boolean, quality integer)
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account();
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m is null or p_radius_m not between 1 and 20000 then raise exception 'invalid_location'; end if;
  return query select s.id, s.name, s.category, s.lat, s.lng, s.address, s.suburb, s.open_now, s.open_24h, s.quality
  from public.safe_places s where s.active and s.review_status = 'approved' and (s.reverify_by is null or s.reverify_by >= current_date)
    and 6371000 * 2 * asin(sqrt(least(1.0, power(sin(radians(s.lat - p_lat) / 2), 2) + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2)))) <= p_radius_m
  order by s.quality desc, s.id limit 100;
end; $$;

create function public.suggest_safe_place(p_name text, p_category text, p_lat double precision, p_lng double precision, p_address text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('safe_place:' || v_user::text, 0));
  if p_name is null or length(trim(p_name)) not between 2 and 200 or coalesce(length(p_address), 0) > 300 then raise exception 'invalid_place'; end if;
  if (select count(*) from public.safe_place_audit where actor_id = v_user and action = 'suggested' and changed_at > now() - interval '1 day') >= 10 then raise exception 'rate_limited'; end if;
  insert into public.safe_places(name, kind, category, lat, lng, address, suggested_by, active)
  values (trim(p_name), p_category, p_category, p_lat, p_lng, p_address, v_user, false) returning id into v_id;
  insert into public.safe_place_audit(safe_place_id, actor_id, action) values (v_id, v_user, 'suggested');
  insert into public.buddy_audit_events(actor_id, event) values (v_user, 'safe_place_suggested');
  return v_id;
end; $$;

create function public.list_community_alerts(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision)
returns table(id uuid, kind text, lat double precision, lng double precision, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account();
  if p_min_lat is null or p_max_lat is null or p_min_lng is null or p_max_lng is null or
    p_min_lat < -90 or p_max_lat > 90 or p_min_lng < -180 or p_max_lng > 180 or
    p_max_lat < p_min_lat or p_max_lng < p_min_lng or p_max_lat - p_min_lat > 1 or p_max_lng - p_min_lng > 1 then raise exception 'invalid_bounds'; end if;
  return query select a.id, a.kind, a.lat, a.lng, a.created_at, a.expires_at from public.buddy_community_alerts a
    where a.resolved_at is null and a.expires_at > now() and a.lat between p_min_lat and p_max_lat and a.lng between p_min_lng and p_max_lng
    order by a.created_at desc limit 100;
end; $$;

create function public.report_community_alert(p_kind text, p_lat double precision, p_lng double precision) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_alert:' || v_user::text, 0));
  if (select count(*) from public.buddy_community_alerts where reporter_id = v_user and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate_limited'; end if;
  insert into public.buddy_community_alerts(reporter_id, kind, lat, lng)
  values (v_user, p_kind, round(p_lat::numeric, 3), round(p_lng::numeric, 3)) returning id into v_id;
  insert into public.buddy_audit_events(actor_id, event) values (v_user, 'community_alert_reported');
  return v_id;
end; $$;

create function public.set_bubble_meeting_location(p_bubble_id uuid, p_lat double precision, p_lng double precision, p_allow_landmarks boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  perform public.buddy_require_meeting_member(p_bubble_id, v_user);
  insert into public.buddy_bubble_meeting_locations(bubble_id, user_id, lat, lng, allow_landmarks)
  values (p_bubble_id, v_user, p_lat, p_lng, p_allow_landmarks)
  on conflict (bubble_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, allow_landmarks = excluded.allow_landmarks, updated_at = now();
end; $$;

create function public.get_bubble_meeting_inputs(p_user_id uuid, p_bubble_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.buddy_require_meeting_member(p_bubble_id, p_user_id);
  select jsonb_build_object('total', count(*), 'ready', count(l.user_id), 'allowLandmarks', coalesce(bool_and(coalesce(l.allow_landmarks, false)), false),
    'locations', coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'lat', l.lat, 'lng', l.lng, 'destLat', t.destination_lat, 'destLng', t.destination_lng)) filter (where l.user_id is not null), '[]'::jsonb))
  into v_result from public.buddy_bubble_members m
  left join public.buddy_bubble_meeting_locations l on l.bubble_id = m.bubble_id and l.user_id = m.user_id and l.updated_at > now() - interval '10 minutes'
  left join public.buddy_trips t on t.id = m.trip_id
  where m.bubble_id = p_bubble_id and m.left_at is null;
  if (v_result->>'ready')::integer = (v_result->>'total')::integer and (v_result->>'total')::integer >= 2 then
    insert into public.buddy_bubble_meetings(bubble_id) values (p_bubble_id) on conflict do nothing;
    if exists (select 1 from public.buddy_bubble_meetings where bubble_id = p_bubble_id and generation_requested_at > now() - interval '30 seconds') then raise exception 'rate_limited'; end if;
    update public.buddy_bubble_meetings set generation_requested_at = now() where bubble_id = p_bubble_id;
  end if;
  return v_result || jsonb_build_object(
    'excludeSpotIds', coalesce((select jsonb_agg(distinct c.spot_id) from public.buddy_bubble_spot_feedback f join public.buddy_bubble_spot_candidates c on c.id = f.candidate_id where f.bubble_id = p_bubble_id and c.spot_id is not null), '[]'::jsonb),
    'excludeOsmRefs', coalesce((select jsonb_agg(distinct c.osm_ref) from public.buddy_bubble_spot_feedback f join public.buddy_bubble_spot_candidates c on c.id = f.candidate_id where f.bubble_id = p_bubble_id and c.osm_ref is not null), '[]'::jsonb));
end; $$;

create function public.save_bubble_spot_candidates(p_user_id uuid, p_bubble_id uuid, p_candidates jsonb, p_regenerate boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare v_round integer; v_generated timestamptz; v_item jsonb;
begin
  perform public.buddy_require_meeting_member(p_bubble_id, p_user_id);
  insert into public.buddy_bubble_meetings(bubble_id) values (p_bubble_id) on conflict do nothing;
  select round, generated_at into v_round, v_generated from public.buddy_bubble_meetings where bubble_id = p_bubble_id for update;
  if v_round > 0 and not p_regenerate then return v_round; end if;
  if v_generated > now() - interval '30 seconds' then raise exception 'rate_limited'; end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 10 then raise exception 'invalid_candidates'; end if;
  if (select count(*) from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null) < 2 then raise exception 'waiting_for_locations'; end if;
  if exists (select 1 from public.buddy_bubble_members m left join public.buddy_bubble_meeting_locations l on l.bubble_id = m.bubble_id and l.user_id = m.user_id
    where m.bubble_id = p_bubble_id and m.left_at is null and (l.user_id is null or l.updated_at <= now() - interval '10 minutes')) then raise exception 'waiting_for_locations'; end if;
  v_round := v_round + 1;
  update public.buddy_bubble_meetings set selected_candidate_id = null, round = v_round, generated_at = now(),
    member_ids = array(select user_id from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null order by user_id)
    where bubble_id = p_bubble_id;
  for v_item in select value from jsonb_array_elements(p_candidates) loop
    if jsonb_typeof(v_item->'distM') is distinct from 'object' then raise exception 'invalid_candidates'; end if;
    if (select count(*) from jsonb_object_keys(v_item->'distM')) <> (select count(*) from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null) then raise exception 'membership_changed'; end if;
    if exists (select 1 from public.buddy_bubble_members m where m.bubble_id = p_bubble_id and m.left_at is null and not (v_item->'distM' ? m.user_id::text)) then raise exception 'membership_changed'; end if;
    if v_item->>'source' = 'curated' and not exists (select 1 from public.safe_places where id = (v_item->>'spotId')::uuid and active and review_status = 'approved' and (reverify_by is null or reverify_by >= current_date)) then raise exception 'invalid_candidate'; end if;
    if v_item->>'source' = 'landmark' and exists (select 1 from public.buddy_bubble_meeting_locations l join public.buddy_bubble_members m on m.bubble_id = l.bubble_id and m.user_id = l.user_id where l.bubble_id = p_bubble_id and m.left_at is null and not l.allow_landmarks) then raise exception 'invalid_candidate'; end if;
    if exists (select 1 from public.buddy_bubble_spot_feedback f join public.buddy_bubble_spot_candidates c on c.id = f.candidate_id where f.bubble_id = p_bubble_id and
      ((c.spot_id is not null and c.spot_id::text = v_item->>'spotId') or (c.osm_ref is not null and c.osm_ref = v_item->>'osmRef'))) then raise exception 'invalid_candidate'; end if;
    insert into public.buddy_bubble_spot_candidates(bubble_id, round, source, spot_id, osm_ref, name, category, lat, lng, address, score, dist_m, max_dist_m, balanced)
    values (p_bubble_id, v_round, v_item->>'source', (v_item->>'spotId')::uuid, v_item->>'osmRef', v_item->>'name', v_item->>'category',
      (v_item->>'lat')::double precision, (v_item->>'lng')::double precision, v_item->>'address', (v_item->>'score')::double precision,
      v_item->'distM', (v_item->>'maxDistM')::double precision, (v_item->>'balanced')::boolean);
  end loop;
  insert into public.buddy_audit_events(bubble_id, actor_id, event, details) values (p_bubble_id, p_user_id, 'spot_options_generated', jsonb_build_object('round', v_round));
  return v_round;
end; $$;

create function public.get_bubble_meeting(p_bubble_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_round integer; v_selected uuid; v_total integer; v_changed boolean;
begin
  perform public.buddy_require_meeting_member(p_bubble_id, v_user);
  select round, selected_candidate_id into v_round, v_selected from public.buddy_bubble_meetings where bubble_id = p_bubble_id;
  select count(*) into v_total from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null;
  select member_ids is distinct from array(select user_id from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null order by user_id) into v_changed
    from public.buddy_bubble_meetings where bubble_id = p_bubble_id;
  if v_selected is not null and (v_total < 2 or v_changed or exists (select 1 from public.buddy_bubble_members m where m.bubble_id = p_bubble_id and m.left_at is null and not exists
    (select 1 from public.buddy_bubble_spot_votes v where v.bubble_id = p_bubble_id and v.round = v_round and v.user_id = m.user_id and v.candidate_id = v_selected)) or
    (exists(select 1 from public.buddy_bubble_spot_candidates where id = v_selected and source = 'landmark') and exists
      (select 1 from public.buddy_bubble_members m left join public.buddy_bubble_meeting_locations l on l.bubble_id = m.bubble_id and l.user_id = m.user_id where m.bubble_id = p_bubble_id and m.left_at is null and not coalesce(l.allow_landmarks, false)))) then
    v_selected := null;
    update public.buddy_bubble_meetings set selected_candidate_id = null where bubble_id = p_bubble_id;
  end if;
  if v_selected is not null and exists(select 1 from public.buddy_bubble_spot_candidates c where c.id = v_selected and c.source = 'curated' and not exists
    (select 1 from public.safe_places s where s.id = c.spot_id and s.active and s.review_status = 'approved' and (s.reverify_by is null or s.reverify_by >= current_date))) then
    v_selected := null;
    update public.buddy_bubble_meetings set selected_candidate_id = null where bubble_id = p_bubble_id;
  end if;
  return jsonb_build_object('round', coalesce(v_round, 0), 'selectedCandidateId', v_selected, 'total', v_total, 'membershipChanged', coalesce(v_changed and v_round > 0, false),
    'ready', (select count(*) from public.buddy_bubble_meeting_locations l join public.buddy_bubble_members m on m.bubble_id = l.bubble_id and m.user_id = l.user_id where l.bubble_id = p_bubble_id and m.left_at is null and l.updated_at > now() - interval '10 minutes'),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'source', c.source, 'lat', c.lat, 'lng', c.lng,
      'address', c.address, 'score', c.score, 'distanceM', (c.dist_m->>v_user::text)::double precision, 'maxDistanceM', c.max_dist_m, 'balanced', c.balanced,
      'votes', (select count(*) from public.buddy_bubble_spot_votes v join public.buddy_bubble_members m on m.bubble_id = v.bubble_id and m.user_id = v.user_id where v.candidate_id = c.id and m.left_at is null),
      'yourVote', exists(select 1 from public.buddy_bubble_spot_votes v where v.candidate_id = c.id and v.user_id = v_user),
      'rejected', exists(select 1 from public.buddy_bubble_spot_feedback f where f.candidate_id = c.id)) order by c.score desc)
      from public.buddy_bubble_spot_candidates c where c.bubble_id = p_bubble_id and c.round = v_round and not v_changed and
        (c.source <> 'curated' or exists(select 1 from public.safe_places s where s.id = c.spot_id and s.active and s.review_status = 'approved' and (s.reverify_by is null or s.reverify_by >= current_date))) and
        (c.source <> 'landmark' or not exists(select 1 from public.buddy_bubble_members m left join public.buddy_bubble_meeting_locations l on l.bubble_id = m.bubble_id and l.user_id = m.user_id where m.bubble_id = p_bubble_id and m.left_at is null and not coalesce(l.allow_landmarks, false)))), '[]'::jsonb),
    'lookFor', coalesce((select jsonb_agg(jsonb_build_object('alias', case when m.user_id = v_user then 'You' else coalesce(t.alias, 'Buddy') end, 'you', m.user_id = v_user, 'topColor', m.clothing_top_color, 'carryingBag', m.carrying_bag))
      from public.buddy_bubble_members m left join public.buddy_trips t on t.id = m.trip_id where m.bubble_id = p_bubble_id and m.left_at is null), '[]'::jsonb));
end; $$;

create function public.vote_bubble_spot(p_bubble_id uuid, p_round integer, p_candidate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_round integer; v_selected uuid;
begin
  perform public.buddy_require_meeting_member(p_bubble_id, v_user);
  select round, selected_candidate_id into v_round, v_selected from public.buddy_bubble_meetings where bubble_id = p_bubble_id for update;
  if v_round is null or p_round is distinct from v_round then raise exception 'stale_round'; end if;
  if exists (select 1 from public.buddy_bubble_meetings where bubble_id = p_bubble_id and member_ids is distinct from
    array(select user_id from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null order by user_id)) then raise exception 'membership_changed'; end if;
  if not exists (select 1 from public.buddy_bubble_spot_candidates where id = p_candidate_id and bubble_id = p_bubble_id and round = v_round)
    or exists (select 1 from public.buddy_bubble_spot_feedback where bubble_id = p_bubble_id and candidate_id = p_candidate_id) then raise exception 'invalid_candidate'; end if;
  if exists(select 1 from public.buddy_bubble_spot_candidates where id = p_candidate_id and source = 'landmark') and exists
    (select 1 from public.buddy_bubble_members m left join public.buddy_bubble_meeting_locations l on l.bubble_id = m.bubble_id and l.user_id = m.user_id where m.bubble_id = p_bubble_id and m.left_at is null and not coalesce(l.allow_landmarks, false)) then raise exception 'invalid_candidate'; end if;
  if exists(select 1 from public.buddy_bubble_spot_candidates c where c.id = p_candidate_id and c.source = 'curated' and not exists
    (select 1 from public.safe_places s where s.id = c.spot_id and s.active and s.review_status = 'approved' and (s.reverify_by is null or s.reverify_by >= current_date))) then raise exception 'invalid_candidate'; end if;
  insert into public.buddy_bubble_spot_votes(bubble_id, round, candidate_id, user_id) values (p_bubble_id, v_round, p_candidate_id, v_user)
    on conflict (bubble_id, round, user_id) do update set candidate_id = excluded.candidate_id, updated_at = now();
  update public.buddy_bubble_meetings set selected_candidate_id = null where bubble_id = p_bubble_id;
  if (select count(*) from public.buddy_bubble_members where bubble_id = p_bubble_id and left_at is null) >= 2 and not exists (
    select 1 from public.buddy_bubble_members m where m.bubble_id = p_bubble_id and m.left_at is null and not exists
    (select 1 from public.buddy_bubble_spot_votes v where v.bubble_id = p_bubble_id and v.round = v_round and v.user_id = m.user_id and v.candidate_id = p_candidate_id)) then
    update public.buddy_bubble_meetings set selected_candidate_id = p_candidate_id where bubble_id = p_bubble_id;
    if v_selected is distinct from p_candidate_id then
      insert into public.buddy_audit_events(bubble_id, actor_id, event, details) values (p_bubble_id, v_user, 'spot_selected', jsonb_build_object('round', v_round));
    end if;
  end if;
  insert into public.buddy_audit_events(bubble_id, actor_id, event, details) values (p_bubble_id, v_user, 'spot_voted', jsonb_build_object('round', v_round));
end; $$;

create function public.feedback_bubble_spot(p_bubble_id uuid, p_round integer, p_candidate_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  perform public.buddy_require_meeting_member(p_bubble_id, v_user);
  if not exists (select 1 from public.buddy_bubble_meetings s join public.buddy_bubble_spot_candidates c on c.bubble_id = s.bubble_id and c.round = s.round
    where s.bubble_id = p_bubble_id and s.round = p_round and c.id = p_candidate_id) then raise exception 'stale_round'; end if;
  insert into public.buddy_bubble_spot_feedback(bubble_id, candidate_id, user_id, reason) values (p_bubble_id, p_candidate_id, v_user, p_reason)
    on conflict (bubble_id, candidate_id, user_id) do update set reason = excluded.reason;
  delete from public.buddy_bubble_spot_votes where bubble_id = p_bubble_id and candidate_id = p_candidate_id;
  update public.buddy_bubble_meetings set selected_candidate_id = null where bubble_id = p_bubble_id and selected_candidate_id = p_candidate_id;
  insert into public.buddy_audit_events(bubble_id, actor_id, event, details) values (p_bubble_id, v_user, 'spot_feedback', jsonb_build_object('reason', p_reason));
end; $$;

create function public.set_bubble_look_for(p_bubble_id uuid, p_top_color text, p_carrying_bag boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  perform public.buddy_require_meeting_member(p_bubble_id, v_user);
  update public.buddy_bubble_members set clothing_top_color = p_top_color, carrying_bag = p_carrying_bag where bubble_id = p_bubble_id and user_id = v_user;
  insert into public.buddy_audit_events(bubble_id, actor_id, event) values (p_bubble_id, v_user, 'look_for_updated');
end; $$;

create function public.list_buddy_meeting_bubbles() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  return coalesce((select jsonb_agg(to_jsonb(s)) from (
    select b.id, b.expires_at, (select count(*) from public.buddy_bubble_members m where m.bubble_id = b.id and m.left_at is null) as member_count
    from public.buddy_bubbles b join public.buddy_bubble_members own on own.bubble_id = b.id and own.user_id = v_user and own.left_at is null
    where b.closed_at is null and b.expires_at > now() order by b.created_at desc limit 20
  ) s), '[]'::jsonb);
end; $$;

create function public.admin_create_safe_place(p_name text, p_category text, p_lat double precision, p_lng double precision, p_address text, p_quality integer, p_open_24h boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(true); v_id uuid;
begin
  if p_name is null or length(trim(p_name)) not between 2 and 200 or coalesce(length(p_address), 0) > 300 then raise exception 'invalid_place'; end if;
  insert into public.safe_places(name, kind, category, lat, lng, address, quality, open_24h, review_status, active, verified_by, verified_at, reverify_by)
  values (trim(p_name), p_category, p_category, p_lat, p_lng, p_address, p_quality, p_open_24h, 'approved', true, v_user, now(), current_date + 90) returning id into v_id;
  insert into public.safe_place_audit(safe_place_id, actor_id, action) values (v_id, v_user, 'created');
  return v_id;
end; $$;

create function public.admin_list_buddy_places() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account(true);
  return jsonb_build_object('places', coalesce((select jsonb_agg(to_jsonb(s)) from (select id, name, category, lat, lng, address, quality, review_status, active, open_24h, reverify_by from public.safe_places order by updated_at desc limit 200) s), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(a)) from (select id, kind, lat, lng, created_at, expires_at from public.buddy_community_alerts where resolved_at is null and expires_at > now() order by created_at desc limit 100) a), '[]'::jsonb));
end; $$;

create function public.admin_review_safe_place(p_id uuid, p_status text, p_quality integer, p_active boolean, p_open_24h boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(true);
begin
  update public.safe_places set review_status = p_status, quality = p_quality, active = p_active and p_status = 'approved', open_24h = p_open_24h,
    verified_by = v_user, verified_at = case when p_status = 'approved' then now() else null end,
    reverify_by = case when p_status = 'approved' then current_date + 90 else null end, updated_at = now() where id = p_id;
  if not found then raise exception 'not_found'; end if;
  insert into public.safe_place_audit(safe_place_id, actor_id, action, detail) values (p_id, v_user, 'reviewed', jsonb_build_object('status', p_status, 'quality', p_quality));
end; $$;

create function public.admin_resolve_community_alert(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(true);
begin
  update public.buddy_community_alerts set resolved_at = now(), resolved_by = v_user where id = p_id and resolved_at is null;
  if not found then raise exception 'not_found'; end if;
end; $$;

revoke all on function public.buddy_require_account(boolean), public.buddy_require_meeting_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_bubble_meeting_inputs(uuid, uuid), public.save_bubble_spot_candidates(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.get_bubble_meeting_inputs(uuid, uuid), public.save_bubble_spot_candidates(uuid, uuid, jsonb, boolean) to service_role;
revoke all on function public.list_meetup_candidates_near(double precision, double precision, integer),
  public.suggest_safe_place(text, text, double precision, double precision, text),
  public.list_community_alerts(double precision, double precision, double precision, double precision),
  public.report_community_alert(text, double precision, double precision),
  public.set_bubble_meeting_location(uuid, double precision, double precision, boolean), public.get_bubble_meeting(uuid),
  public.vote_bubble_spot(uuid, integer, uuid), public.feedback_bubble_spot(uuid, integer, uuid, text), public.set_bubble_look_for(uuid, text, boolean),
  public.list_buddy_meeting_bubbles(), public.admin_create_safe_place(text, text, double precision, double precision, text, integer, boolean),
  public.admin_list_buddy_places(), public.admin_review_safe_place(uuid, text, integer, boolean, boolean), public.admin_resolve_community_alert(uuid) from public, anon;
grant execute on function public.list_meetup_candidates_near(double precision, double precision, integer),
  public.suggest_safe_place(text, text, double precision, double precision, text),
  public.list_community_alerts(double precision, double precision, double precision, double precision),
  public.report_community_alert(text, double precision, double precision),
  public.set_bubble_meeting_location(uuid, double precision, double precision, boolean), public.get_bubble_meeting(uuid),
  public.vote_bubble_spot(uuid, integer, uuid), public.feedback_bubble_spot(uuid, integer, uuid, text), public.set_bubble_look_for(uuid, text, boolean),
  public.list_buddy_meeting_bubbles(), public.admin_create_safe_place(text, text, double precision, double precision, text, integer, boolean),
  public.admin_list_buddy_places(), public.admin_review_safe_place(uuid, text, integer, boolean, boolean), public.admin_resolve_community_alert(uuid) to authenticated;

commit;