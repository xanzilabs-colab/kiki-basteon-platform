begin;

create or replace function public.list_community_alert_comments(p_alert_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
begin
  if not exists (
    select 1 from public.buddy_community_alerts
    where id = p_alert_id
  ) then raise exception 'not_found'; end if;

  return jsonb_build_object(
    'comments',
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at)
        order by c.created_at
      )
      from public.buddy_community_alert_comments c
      where c.alert_id = p_alert_id
    ), '[]'::jsonb)
  );
end; $$;

revoke all on function public.list_community_alert_comments(uuid)
  from public, anon, authenticated;
grant execute on function public.list_community_alert_comments(uuid)
  to authenticated;

commit;
