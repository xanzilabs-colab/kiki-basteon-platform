begin;

alter table public.buddy_community_alerts
  alter column expires_at drop not null,
  alter column expires_at drop default;

update public.buddy_community_alerts
set expires_at = null
where expires_at is not null;

drop index if exists public.buddy_community_alerts_live;

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
  if p_min_lat is null or p_max_lat is null or p_min_lng is null or p_max_lng is null or
    p_min_lat < -90 or p_max_lat > 90 or p_min_lng < -180 or p_max_lng > 180 or
    p_max_lat < p_min_lat or p_max_lng < p_min_lng or p_max_lat - p_min_lat > 1 or p_max_lng - p_min_lng > 1 then
    raise exception 'invalid_bounds';
  end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.created_at, a.expires_at
    from public.buddy_community_alerts a
    where a.resolved_at is null
      and a.lat between p_min_lat and p_max_lat
      and a.lng between p_min_lng and p_max_lng
    order by a.created_at desc
    limit 100;
end; $$;

create or replace function public.list_community_alerts_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 10000
)
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
  voted boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90
    or p_lng not between -180 and 180 or p_radius_m not between 500 and 20000 then
    raise exception 'invalid_location';
  end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.location_label, a.detail, a.created_at, a.expires_at,
      count(v.user_id)::integer as upvotes,
      coalesce(bool_or(v.user_id = v_user), false) as voted
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
end $$;

create or replace function public.toggle_community_alert_vote(p_alert_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
  v_voted boolean;
  v_count integer;
begin
  if not exists (
    select 1 from public.buddy_community_alerts
    where id = p_alert_id and resolved_at is null
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
end $$;

create or replace function public.admin_list_buddy_places()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.buddy_require_account(true);
  return jsonb_build_object(
    'places', coalesce((
      select jsonb_agg(to_jsonb(s)) from (
        select id, name, category, lat, lng, address, quality, review_status, active,
          open_24h, reverify_by
        from public.safe_places order by updated_at desc limit 200
      ) s
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select id, kind, lat, lng, created_at, expires_at
        from public.buddy_community_alerts
        where resolved_at is null
        order by created_at desc
        limit 100
      ) a
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.delete_my_community_alert(p_alert_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
begin
  delete from public.community_intel_records
  where source_alert_id = p_alert_id
    and exists (
      select 1 from public.buddy_community_alerts
      where id = p_alert_id and reporter_id = v_user
    );
  delete from public.buddy_community_alerts
  where id = p_alert_id and reporter_id = v_user;
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.delete_my_community_alert(uuid) from public, anon;
grant execute on function public.delete_my_community_alert(uuid) to authenticated;

commit;
