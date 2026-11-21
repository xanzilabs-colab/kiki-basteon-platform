begin;

delete from public.community_intel_records
where source_alert_id between '00000000-0000-4000-8000-000000000101'::uuid
  and '00000000-0000-4000-8000-000000000150'::uuid
  and exists (
    select 1
    from public.buddy_community_alerts a
    where a.id = community_intel_records.source_alert_id
      and a.is_demo
      and left(a.location_label, 11) = 'DEMO ONLY -'
  );

delete from public.buddy_community_alerts
where is_demo
  and id between '00000000-0000-4000-8000-000000000101'::uuid
    and '00000000-0000-4000-8000-000000000150'::uuid
  and left(location_label, 11) = 'DEMO ONLY -';

delete from public.safe_place_audit
where safe_place_id between '00000000-0000-4000-8000-000000000001'::uuid
  and '00000000-0000-4000-8000-000000000040'::uuid
  and exists (
    select 1
    from public.safe_places s
    where s.id = safe_place_audit.safe_place_id
      and s.is_demo
      and left(s.name, 11) = '[DEMO ONLY]'
  );

delete from public.safe_places
where is_demo
  and id between '00000000-0000-4000-8000-000000000001'::uuid
    and '00000000-0000-4000-8000-000000000040'::uuid
  and left(name, 11) = '[DEMO ONLY]';

commit;
