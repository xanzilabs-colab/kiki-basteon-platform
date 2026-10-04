-- Bubble updates must remain available to active members even when the API service
-- client is unavailable. These functions expose only the caller's own Bubble data.
create or replace function public.read_buddy_bubble(p_bubble_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if not exists (
    select 1 from buddy_bubble_members
    where bubble_id = p_bubble_id and user_id = v_user_id and left_at is null
  ) then raise exception 'not_bubble_member'; end if;

  select jsonb_build_object(
    'meetingCode', b.meeting_code,
    'closed', b.closed_at is not null,
    'expiresAt', b.expires_at,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'arrived', m.arrived_at is not null,
        'met', m.met_confirmed_at is not null
      ) order by m.created_at)
      from buddy_bubble_members m
      where m.bubble_id = b.id and m.left_at is null
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'senderId', message.sender_id,
        'messageKey', message.message_key,
        'createdAt', message.created_at
      ) order by message.created_at desc)
      from (
        select sender_id, message_key, created_at
        from buddy_bubble_messages
        where bubble_id = b.id
        order by created_at desc
        limit 20
      ) message
    ), '[]'::jsonb)
  ) into v_result
  from buddy_bubbles b
  where b.id = p_bubble_id;

  if v_result is null then raise exception 'bubble_not_found'; end if;
  return v_result;
end;
$$;

create or replace function public.post_buddy_bubble_update(p_bubble_id uuid, p_message_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if p_message_key not in ('on_my_way', 'at_the_meeting_point', 'running_late', 'i_need_help', 'i_arrived') then
    raise exception 'invalid_message';
  end if;
  if not exists (
    select 1 from buddy_bubble_members
    where bubble_id = p_bubble_id and user_id = v_user_id and left_at is null
  ) then raise exception 'not_bubble_member'; end if;
  insert into buddy_bubble_messages (bubble_id, sender_id, message_key)
  values (p_bubble_id, v_user_id, p_message_key);
  return true;
end;
$$;

revoke all on function public.read_buddy_bubble(uuid) from public, anon;
revoke all on function public.post_buddy_bubble_update(uuid, text) from public, anon;
grant execute on function public.read_buddy_bubble(uuid) to authenticated;
grant execute on function public.post_buddy_bubble_update(uuid, text) to authenticated;