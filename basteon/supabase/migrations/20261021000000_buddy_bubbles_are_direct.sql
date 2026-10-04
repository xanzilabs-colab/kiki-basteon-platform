-- A direct Buddy join must only connect the joining account and the selected account.
-- Do not add the joiner to an existing Bubble that happens to contain the selected Buddy.
-- Retire prior shared groups so they cannot appear in matching or be reused as direct Bubbles.
update public.buddy_bubbles b
set closed_at = coalesce(b.closed_at, now())
where b.closed_at is null
  and (
    select count(*)
    from public.buddy_bubble_members m
    where m.bubble_id = b.id and m.left_at is null
  ) > 2;

create or replace function public.join_buddy_bubble(
  p_joiner uuid,
  p_joiner_trip uuid,
  p_target uuid,
  p_target_trip uuid,
  p_meeting_code text,
  p_expires_at timestamptz
) returns table (joined_bubble_id uuid, created boolean, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bubble uuid;
begin
  if p_joiner = p_target then raise exception 'invalid_target'; end if;
  perform pg_advisory_xact_lock(hashtextextended('buddy_pair:' || least(p_joiner::text, p_target::text) || ':' || greatest(p_joiner::text, p_target::text), 0));

  select b.id into v_bubble
  from public.buddy_bubbles b
  join public.buddy_bubble_members t
    on t.bubble_id = b.id and t.user_id = p_target and t.trip_id = p_target_trip and t.left_at is null
  join public.buddy_bubble_members j
    on j.bubble_id = b.id and j.user_id = p_joiner and j.trip_id = p_joiner_trip and j.left_at is null
  where b.closed_at is null and b.expires_at > now()
    and (
      select count(*)
      from public.buddy_bubble_members m
      where m.bubble_id = b.id and m.left_at is null
    ) = 2
  order by b.created_at desc
  limit 1;
  if v_bubble is not null then
    return query select v_bubble, false, true;
    return;
  end if;

  insert into public.buddy_bubbles (meeting_code, expires_at)
  values (p_meeting_code, p_expires_at)
  returning id into v_bubble;
  insert into public.buddy_bubble_members (bubble_id, user_id, trip_id)
  values (v_bubble, p_target, p_target_trip), (v_bubble, p_joiner, p_joiner_trip);
  return query select v_bubble, true, false;
end;
$$;

revoke execute on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.join_buddy_bubble(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;