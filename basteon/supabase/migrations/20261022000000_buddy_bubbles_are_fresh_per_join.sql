-- Each explicit Join Buddy action starts a new private conversation. Historical Bubble
-- messages must never appear in a later connection, even for the same pair of accounts.
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