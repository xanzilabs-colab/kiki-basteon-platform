begin;

with areas(area_no, area_name, center_lat, center_lng) as (
  values
    (1, 'Johannesburg CBD', -26.2041::double precision, 28.0473::double precision),
    (2, 'Soweto', -26.2485, 27.8540),
    (3, 'Randburg', -26.0936, 28.0064),
    (4, 'Sandton', -26.1076, 28.0567),
    (5, 'Alexandra', -26.1036, 28.1003),
    (6, 'Midrand', -25.9992, 28.1263),
    (7, 'Roodepoort', -26.1625, 27.8725),
    (8, 'Krugersdorp', -26.1000, 27.7667),
    (9, 'Germiston', -26.2259, 28.1700),
    (10, 'Boksburg', -26.2116, 28.2596),
    (11, 'Kempton Park', -26.1000, 28.2333),
    (12, 'Benoni', -26.1885, 28.3208),
    (13, 'Tembisa', -25.9960, 28.2260),
    (14, 'Centurion', -25.8603, 28.1894),
    (15, 'Pretoria CBD', -25.7479, 28.2293),
    (16, 'Mamelodi', -25.7066, 28.3531),
    (17, 'Vanderbijlpark', -26.7111, 27.8379),
    (18, 'Vereeniging', -26.6736, 27.9261),
    (19, 'Springs', -26.2500, 28.4000),
    (20, 'Pretoria West', -25.7652, 28.1700),
    (21, 'Fourways', -25.9950, 28.0040),
    (22, 'Bryanston', -26.0600, 28.0220),
    (23, 'Rosebank', -26.1450, 28.0430),
    (24, 'Melville', -26.1760, 28.0130),
    (25, 'Lenasia', -26.3190, 27.8960),
    (26, 'Florida', -26.1650, 27.9070),
    (27, 'Randfontein', -26.1840, 27.7020),
    (28, 'Bedfordview', -26.1690, 28.1310),
    (29, 'Alberton', -26.2670, 28.1220),
    (30, 'Brakpan', -26.2360, 28.3690),
    (31, 'Edenvale', -26.1390, 28.1520),
    (32, 'Daveyton', -26.1450, 28.4240),
    (33, 'Irene', -25.8770, 28.2170),
    (34, 'Hatfield', -25.7460, 28.2350),
    (35, 'Brooklyn', -25.7730, 28.2280),
    (36, 'Menlyn', -25.7820, 28.2760),
    (37, 'Faerie Glen', -25.7810, 28.3110),
    (38, 'Soshanguve', -25.5270, 28.1000),
    (39, 'Atteridgeville', -25.7690, 28.0940),
    (40, 'Heidelberg', -26.5040, 28.3590)
),
sample_rows as (
  select
    i,
    a.area_name,
    a.center_lat + ((i % 3) - 1) * 0.0008 as lat,
    a.center_lng + (((i + 1) % 3) - 1) * 0.0008 as lng
  from generate_series(1, 40) as ids(i)
  join areas a on a.area_no = i
)
insert into public.safe_places as existing (
  id, name, kind, category, lat, lng, address, suburb, quality, open_24h,
  review_status, active, is_demo, verified_by, verified_at, notes
)
select
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '[DEMO ONLY] Sample place ' || lpad(i::text, 2, '0') || ' - not verified',
  'other_public',
  'other_public',
  lat,
  lng,
  'DEMO ONLY - fictional sample point near ' || area_name || '; not a real venue.',
  area_name,
  1,
  false,
  'pending',
  true,
  true,
  null,
  null,
  'Fictional placeholder for a judge demo. Not a real venue or a verified safe spot.'
from sample_rows
on conflict (id) do update
  set name = excluded.name,
      kind = excluded.kind,
      category = excluded.category,
      lat = excluded.lat,
      lng = excluded.lng,
      address = excluded.address,
      suburb = excluded.suburb,
      quality = excluded.quality,
      open_24h = excluded.open_24h,
      review_status = excluded.review_status,
      active = excluded.active,
      is_demo = excluded.is_demo,
      verified_by = null,
      verified_at = null,
      notes = excluded.notes
  where existing.is_demo
    and left(existing.name, 11) = '[DEMO ONLY]';

with areas(area_no, area_name, center_lat, center_lng) as (
  values
    (1, 'Johannesburg CBD', -26.2041::double precision, 28.0473::double precision),
    (2, 'Soweto', -26.2485, 27.8540),
    (3, 'Randburg', -26.0936, 28.0064),
    (4, 'Sandton', -26.1076, 28.0567),
    (5, 'Alexandra', -26.1036, 28.1003),
    (6, 'Midrand', -25.9992, 28.1263),
    (7, 'Roodepoort', -26.1625, 27.8725),
    (8, 'Krugersdorp', -26.1000, 27.7667),
    (9, 'Germiston', -26.2259, 28.1700),
    (10, 'Boksburg', -26.2116, 28.2596),
    (11, 'Kempton Park', -26.1000, 28.2333),
    (12, 'Benoni', -26.1885, 28.3208),
    (13, 'Tembisa', -25.9960, 28.2260),
    (14, 'Centurion', -25.8603, 28.1894),
    (15, 'Pretoria CBD', -25.7479, 28.2293),
    (16, 'Mamelodi', -25.7066, 28.3531),
    (17, 'Vanderbijlpark', -26.7111, 27.8379),
    (18, 'Vereeniging', -26.6736, 27.9261),
    (19, 'Springs', -26.2500, 28.4000),
    (20, 'Pretoria West', -25.7652, 28.1700),
    (21, 'Fourways', -25.9950, 28.0040),
    (22, 'Bryanston', -26.0600, 28.0220),
    (23, 'Rosebank', -26.1450, 28.0430),
    (24, 'Melville', -26.1760, 28.0130),
    (25, 'Lenasia', -26.3190, 27.8960),
    (26, 'Florida', -26.1650, 27.9070),
    (27, 'Randfontein', -26.1840, 27.7020),
    (28, 'Bedfordview', -26.1690, 28.1310),
    (29, 'Alberton', -26.2670, 28.1220),
    (30, 'Brakpan', -26.2360, 28.3690),
    (31, 'Edenvale', -26.1390, 28.1520),
    (32, 'Daveyton', -26.1450, 28.4240),
    (33, 'Irene', -25.8770, 28.2170),
    (34, 'Hatfield', -25.7460, 28.2350),
    (35, 'Brooklyn', -25.7730, 28.2280),
    (36, 'Menlyn', -25.7820, 28.2760),
    (37, 'Faerie Glen', -25.7810, 28.3110),
    (38, 'Soshanguve', -25.5270, 28.1000),
    (39, 'Atteridgeville', -25.7690, 28.0940),
    (40, 'Heidelberg', -26.5040, 28.3590)
),
sample_rows as (
  select
    i,
    a.area_name,
    a.center_lat + ((i % 3) - 1) * 0.002 as lat,
    a.center_lng + (((i + 1) % 3) - 1) * 0.002 as lng
  from generate_series(1, 50) as ids(i)
  join areas a on a.area_no = ((i - 1) % 40) + 1
)
insert into public.buddy_community_alerts as existing (
  id, reporter_id, kind, lat, lng, created_at, expires_at, resolved_at,
  location_label, detail, is_demo
)
select
  ('00000000-0000-4000-8000-' || lpad((100 + i)::text, 12, '0'))::uuid,
  null,
  case (i - 1) % 4
    when 0 then 'unsafe_area'
    when 1 then 'poor_lighting'
    when 2 then 'harassment'
    else 'road_hazard'
  end,
  lat,
  lng,
  now(),
  now() + interval '90 days',
  null,
  'DEMO ONLY - approximate sample location near ' || area_name,
  'DEMO DATA - Fictional sample only; no real incident reported.',
  true
from sample_rows
on conflict (id) do update
  set kind = excluded.kind,
      lat = excluded.lat,
      lng = excluded.lng,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      resolved_at = null,
      location_label = excluded.location_label,
      detail = excluded.detail,
      is_demo = excluded.is_demo
  where existing.is_demo
    and left(existing.location_label, 11) = 'DEMO ONLY -';

do $$
begin
  if (select count(*) from public.safe_places
      where is_demo and id between '00000000-0000-4000-8000-000000000001'::uuid
        and '00000000-0000-4000-8000-000000000040'::uuid
        and left(name, 11) = '[DEMO ONLY]') <> 40 then
    raise exception 'Gauteng demo seed did not create exactly 40 safe-spot samples';
  end if;
  if (select count(*) from public.buddy_community_alerts
      where is_demo and id between '00000000-0000-4000-8000-000000000101'::uuid
        and '00000000-0000-4000-8000-000000000150'::uuid
        and left(location_label, 11) = 'DEMO ONLY -') <> 50 then
    raise exception 'Gauteng demo seed did not create exactly 50 community-report samples';
  end if;
end $$;

commit;
