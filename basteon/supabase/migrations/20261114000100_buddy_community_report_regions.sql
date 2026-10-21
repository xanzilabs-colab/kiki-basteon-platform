begin;

alter table public.buddy_community_alerts
  add column region jsonb,
  add constraint buddy_community_alerts_region_shape
    check (
      region is null or case
        when jsonb_typeof(region) = 'object'
          and region->>'type' = 'Polygon'
          and jsonb_typeof(region->'coordinates') = 'array'
          and jsonb_array_length(region->'coordinates') = 1
          and jsonb_typeof(region->'coordinates'->0) = 'array'
        then jsonb_array_length(region->'coordinates'->0) between 4 and 101
        else false
      end
    );

drop function public.list_community_alerts_near(double precision, double precision, integer);
create function public.list_community_alerts_near(p_lat double precision, p_lng double precision, p_radius_m integer default 10000)
returns table(id uuid, kind text, lat double precision, lng double precision, location_label text, detail text, created_at timestamptz, expires_at timestamptz, upvotes integer, voted boolean, region jsonb)
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.buddy_require_account();
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_radius_m not between 500 and 20000 then raise exception 'invalid_location'; end if;
  return query
    select a.id, a.kind, a.lat, a.lng, a.location_label, a.detail, a.created_at, a.expires_at,
      count(v.user_id)::integer as upvotes,
      coalesce(bool_or(v.user_id = v_user), false) as voted,
      a.region
    from public.buddy_community_alerts a
    left join public.buddy_community_alert_votes v on v.alert_id = a.id
    where a.resolved_at is null
      and 6371000 * 2 * asin(sqrt(least(1.0, power(sin(radians(a.lat - p_lat) / 2), 2) + cos(radians(p_lat)) * cos(radians(a.lat)) * power(sin(radians(a.lng - p_lng) / 2), 2)))) <= p_radius_m
    group by a.id
    order by count(v.user_id) desc, a.created_at desc
    limit 100;
end $$;
grant execute on function public.list_community_alerts_near(double precision, double precision, integer) to authenticated;

drop function public.report_community_alert_detail(text, double precision, double precision, text, text);
create function public.report_community_alert_detail(
  p_kind text,
  p_lat double precision,
  p_lng double precision,
  p_location_label text,
  p_detail text,
  p_region jsonb default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
  v_id uuid;
  v_ring jsonb;
  v_vertex jsonb;
  v_rounded_ring jsonb := '[]'::jsonb;
  v_distinct_vertices integer;
  v_lat double precision;
  v_lng double precision;
begin
  perform pg_advisory_xact_lock(hashtextextended('community_alert:' || v_user::text, 0));
  if p_kind not in ('unsafe_area', 'poor_lighting', 'harassment', 'road_hazard')
    or p_lat is null or p_lng is null
    or p_lat not between -90 and 90 or p_lng not between -180 and 180
    or length(trim(coalesce(p_location_label, ''))) not between 3 and 300
    or length(trim(coalesce(p_detail, ''))) not between 4 and 500 then
    raise exception 'invalid_alert';
  end if;

  if p_region is not null then
    if jsonb_typeof(p_region) is distinct from 'object' then
      raise exception 'invalid_alert';
    end if;
    if p_region->>'type' is distinct from 'Polygon' then
      raise exception 'invalid_alert';
    end if;
    if jsonb_typeof(p_region->'coordinates') is distinct from 'array' then
      raise exception 'invalid_alert';
    end if;
    if jsonb_array_length(p_region->'coordinates') <> 1 then
      raise exception 'invalid_alert';
    end if;
    if jsonb_typeof(p_region->'coordinates'->0) is distinct from 'array' then
      raise exception 'invalid_alert';
    end if;
    v_ring := p_region->'coordinates'->0;
    if jsonb_array_length(v_ring) < 4 or jsonb_array_length(v_ring) > 101 then
      raise exception 'invalid_alert';
    end if;
    for v_vertex in select value from jsonb_array_elements(v_ring) loop
      if jsonb_typeof(v_vertex) is distinct from 'array' then
        raise exception 'invalid_alert';
      end if;
      if jsonb_array_length(v_vertex) <> 2 then
        raise exception 'invalid_alert';
      end if;
      if jsonb_typeof(v_vertex->0) is distinct from 'number'
        or jsonb_typeof(v_vertex->1) is distinct from 'number' then
        raise exception 'invalid_alert';
      end if;
      v_lng := (v_vertex->>0)::double precision;
      v_lat := (v_vertex->>1)::double precision;
      if v_lng not between -180 and 180 or v_lat not between -90 and 90 then
        raise exception 'invalid_alert';
      end if;
      v_rounded_ring := v_rounded_ring || jsonb_build_array(jsonb_build_array(
        round(v_lng::numeric, 3),
        round(v_lat::numeric, 3)
      ));
    end loop;
    if v_ring->0 <> v_ring->(jsonb_array_length(v_ring) - 1) then
      raise exception 'invalid_alert';
    end if;
    select count(distinct value)::integer into v_distinct_vertices
      from jsonb_array_elements(v_ring) with ordinality as vertices(value, ordinal)
      where ordinal < jsonb_array_length(v_ring);
    if v_distinct_vertices < 3 then
      raise exception 'invalid_alert';
    end if;
    p_region := jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(v_rounded_ring));
  end if;

  if (select count(*) from public.buddy_community_alerts where reporter_id = v_user and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate_limited'; end if;
  insert into public.buddy_community_alerts(reporter_id, kind, lat, lng, location_label, detail, region)
  values (v_user, p_kind, round(p_lat::numeric, 3), round(p_lng::numeric, 3), trim(p_location_label), trim(p_detail), p_region)
  returning id into v_id;
  insert into public.buddy_audit_events(actor_id, event) values (v_user, 'community_alert_reported');
  return v_id;
end $$;

revoke all on function public.list_community_alerts_near(double precision, double precision, integer),
  public.report_community_alert_detail(text, double precision, double precision, text, text, jsonb)
  from public, anon;
grant execute on function public.list_community_alerts_near(double precision, double precision, integer),
  public.report_community_alert_detail(text, double precision, double precision, text, text, jsonb)
  to authenticated;

commit;
