begin;

alter table public.safe_places
  add column if not exists is_demo boolean not null default false;

alter table public.buddy_community_alerts
  add column if not exists is_demo boolean not null default false;

create function public.list_safe_places_near(p_lat double precision, p_lng double precision, p_radius_m integer default 3000)
returns table(id uuid, name text, category text, lat double precision, lng double precision, address text, suburb text, open_now boolean, open_24h boolean, quality integer, is_demo boolean)
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account();
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
    or p_radius_m is null or p_radius_m not between 1 and 20000 then
    raise exception 'invalid_location';
  end if;
  return query
    select s.id, s.name, s.category, s.lat, s.lng, s.address, s.suburb, s.open_now, s.open_24h, s.quality, s.is_demo
    from public.safe_places s
    where s.active
      and ((s.is_demo and s.review_status = 'pending')
        or (not s.is_demo and s.review_status = 'approved' and (s.reverify_by is null or s.reverify_by >= current_date)))
      and 6371000 * 2 * asin(sqrt(least(1.0,
        power(sin(radians(s.lat - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2)
      ))) <= p_radius_m
    order by s.quality desc, s.id
    limit 100;
end; $$;
revoke all on function public.list_safe_places_near(double precision, double precision, integer) from public, anon;
grant execute on function public.list_safe_places_near(double precision, double precision, integer) to authenticated;

create or replace function public.list_community_alerts(
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision
)
returns table(id uuid, kind text, lat double precision, lng double precision, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account();
  if p_min_lat is null or p_max_lat is null or p_min_lng is null or p_max_lng is null
    or p_min_lat < -90 or p_max_lat > 90 or p_min_lng < -180 or p_max_lng > 180
    or p_max_lat < p_min_lat or p_max_lng < p_min_lng or p_max_lat - p_min_lat > 1 or p_max_lng - p_min_lng > 1 then
    raise exception 'invalid_bounds';
  end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.created_at, a.expires_at
    from public.buddy_community_alerts a
    where a.resolved_at is null
      and not a.is_demo
      and a.lat between p_min_lat and p_max_lat
      and a.lng between p_min_lng and p_max_lng
    order by a.created_at desc
    limit 100;
end; $$;
revoke all on function public.list_community_alerts(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.list_community_alerts(double precision, double precision, double precision, double precision) to authenticated;

drop function public.list_community_alerts_near(double precision, double precision, integer);
create function public.list_community_alerts_near(p_lat double precision, p_lng double precision, p_radius_m integer default 10000)
returns table(
  id uuid,
  kind text,
  lat double precision,
  lng double precision,
  location_label text,
  detail text,
  created_at timestamptz,
  expires_at timestamptz,
  upvotes integer,
  voted boolean,
  region jsonb,
  is_demo boolean
)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90
    or p_lng not between -180 and 180 or p_radius_m not between 500 and 20000 then
    raise exception 'invalid_location';
  end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.location_label, a.detail, a.created_at, a.expires_at,
      count(v.user_id)::integer as upvotes,
      coalesce(bool_or(v.user_id = v_user), false) as voted,
      a.region,
      a.is_demo
    from public.buddy_community_alerts a
    left join public.buddy_community_alert_votes v on v.alert_id = a.id
    where a.resolved_at is null
      and 6371000 * 2 * asin(sqrt(least(1.0,
        power(sin(radians(a.lat - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(a.lat)) * power(sin(radians(a.lng - p_lng) / 2), 2)
      ))) <= p_radius_m
    group by a.id
    order by count(v.user_id) desc, a.created_at desc
    limit 100;
end; $$;
revoke all on function public.list_community_alerts_near(double precision, double precision, integer) from public, anon;
grant execute on function public.list_community_alerts_near(double precision, double precision, integer) to authenticated;

create or replace function public.toggle_community_alert_vote(p_alert_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
  v_voted boolean;
  v_count integer;
begin
  if not exists (
    select 1 from public.buddy_community_alerts
    where id = p_alert_id and resolved_at is null and not is_demo
  ) then
    raise exception 'not_found';
  end if;
  delete from public.buddy_community_alert_votes
  where alert_id = p_alert_id and user_id = v_user;
  if found then
    v_voted := false;
  else
    insert into public.buddy_community_alert_votes(alert_id, user_id)
    values (p_alert_id, v_user);
    v_voted := true;
  end if;
  select count(*) into v_count
  from public.buddy_community_alert_votes where alert_id = p_alert_id;
  return jsonb_build_object('voted', v_voted, 'upvotes', v_count);
end; $$;

create or replace function public.admin_list_buddy_places()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account(true);
  return jsonb_build_object(
    'places', coalesce((
      select jsonb_agg(to_jsonb(s)) from (
        select id, name, category, lat, lng, address, quality, review_status, active,
          open_24h, reverify_by, is_demo
        from public.safe_places order by updated_at desc limit 200
      ) s
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select id, kind, lat, lng, created_at, expires_at, is_demo
        from public.buddy_community_alerts
        where resolved_at is null
        order by created_at desc
        limit 100
      ) a
    ), '[]'::jsonb)
  );
end; $$;

create or replace function public.admin_review_safe_place(p_id uuid, p_status text, p_quality integer, p_active boolean, p_open_24h boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(true);
begin
  update public.safe_places
  set review_status = p_status,
      quality = p_quality,
      active = p_active and p_status = 'approved',
      open_24h = p_open_24h,
      verified_by = v_user,
      verified_at = case when p_status = 'approved' then now() else null end,
      reverify_by = case when p_status = 'approved' then current_date + 90 else null end,
      updated_at = now()
  where id = p_id and not is_demo;
  if not found then raise exception 'not_found'; end if;
  insert into public.safe_place_audit(safe_place_id, actor_id, action, detail)
  values (p_id, v_user, 'reviewed', jsonb_build_object('status', p_status, 'quality', p_quality));
end; $$;

create or replace function public.admin_resolve_community_alert(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account(true);
begin
  update public.buddy_community_alerts
  set resolved_at = now(), resolved_by = v_user
  where id = p_id and resolved_at is null and not is_demo;
  if not found then raise exception 'not_found'; end if;
end; $$;

revoke all on function public.toggle_community_alert_vote(uuid) from public, anon;
grant execute on function public.toggle_community_alert_vote(uuid) to authenticated;
revoke all on function public.admin_list_buddy_places(), public.admin_review_safe_place(uuid, text, integer, boolean, boolean), public.admin_resolve_community_alert(uuid) from public, anon;
grant execute on function public.admin_list_buddy_places(), public.admin_review_safe_place(uuid, text, integer, boolean, boolean), public.admin_resolve_community_alert(uuid) to authenticated;

commit;
