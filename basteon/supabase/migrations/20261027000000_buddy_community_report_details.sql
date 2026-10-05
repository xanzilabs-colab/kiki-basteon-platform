begin;

alter table public.buddy_community_alerts
  add column location_label text,
  add column detail text;

create table public.buddy_community_alert_votes (
  alert_id uuid not null references public.buddy_community_alerts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);
create index buddy_community_alert_votes_alert on public.buddy_community_alert_votes(alert_id);
alter table public.buddy_community_alert_votes enable row level security;
revoke all on public.buddy_community_alert_votes from anon, authenticated;

create function public.list_community_alerts_near(p_lat double precision, p_lng double precision, p_radius_m integer default 10000)
returns table(id uuid, kind text, lat double precision, lng double precision, location_label text, detail text, created_at timestamptz, expires_at timestamptz, upvotes integer, voted boolean)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m not between 500 and 20000 then raise exception 'invalid_location'; end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.location_label, a.detail, a.created_at, a.expires_at,
      count(v.user_id)::integer as upvotes,
      bool_or(v.user_id = v_user) as voted
    from public.buddy_community_alerts a
    left join public.buddy_community_alert_votes v on v.alert_id = a.id
    where a.resolved_at is null and a.expires_at > now()
      and 6371000 * 2 * asin(sqrt(least(1.0, power(sin(radians(a.lat - p_lat) / 2), 2) + cos(radians(p_lat)) * cos(radians(a.lat)) * power(sin(radians(a.lng - p_lng) / 2), 2)))) <= p_radius_m
    group by a.id
    order by count(v.user_id) desc, a.created_at desc
    limit 100;
end $$;

create function public.report_community_alert_detail(p_kind text, p_lat double precision, p_lng double precision, p_location_label text, p_detail text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_alert:' || v_user::text, 0));
  if p_kind not in ('unsafe_area', 'poor_lighting', 'harassment', 'road_hazard') or p_lat not between -90 and 90 or p_lng not between -180 and 180 or length(trim(coalesce(p_location_label, ''))) not between 3 and 300 or length(trim(coalesce(p_detail, ''))) not between 4 and 500 then raise exception 'invalid_alert'; end if;
  if (select count(*) from public.buddy_community_alerts where reporter_id = v_user and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate_limited'; end if;
  insert into public.buddy_community_alerts(reporter_id, kind, lat, lng, location_label, detail)
  values (v_user, p_kind, round(p_lat::numeric, 3), round(p_lng::numeric, 3), trim(p_location_label), trim(p_detail)) returning id into v_id;
  insert into public.buddy_audit_events(actor_id, event) values (v_user, 'community_alert_reported');
  return v_id;
end $$;

create function public.toggle_community_alert_vote(p_alert_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(); v_voted boolean; v_count integer;
begin
  if not exists (select 1 from public.buddy_community_alerts where id = p_alert_id and resolved_at is null and expires_at > now()) then raise exception 'not_found'; end if;
  delete from public.buddy_community_alert_votes where alert_id = p_alert_id and user_id = v_user;
  if found then v_voted := false; else insert into public.buddy_community_alert_votes(alert_id, user_id) values (p_alert_id, v_user); v_voted := true; end if;
  select count(*) into v_count from public.buddy_community_alert_votes where alert_id = p_alert_id;
  return jsonb_build_object('voted', v_voted, 'upvotes', v_count);
end $$;

revoke all on function public.list_community_alerts_near(double precision, double precision, integer), public.report_community_alert_detail(text, double precision, double precision, text, text), public.toggle_community_alert_vote(uuid) from public, anon;
grant execute on function public.list_community_alerts_near(double precision, double precision, integer), public.report_community_alert_detail(text, double precision, double precision, text, text), public.toggle_community_alert_vote(uuid) to authenticated;

commit;