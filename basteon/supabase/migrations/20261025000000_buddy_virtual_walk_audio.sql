alter table public.buddy_virtual_walks
  add column mode text not null default 'audio' check (mode = 'audio'),
  add column last_heartbeat_at timestamptz not null default now(),
  add column callee_id uuid references public.profiles(id) on delete set null,
  add column caller_heartbeat_at timestamptz not null default now(),
  add column callee_heartbeat_at timestamptz;

create function public.buddy_audio_prepare(p_bubble_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public.buddy_require_account(); v_open boolean;
begin
  select closed_at is null and expires_at > now() into v_open
  from public.buddy_bubbles where id = p_bubble_id for update;
  if not exists (select 1 from public.buddy_bubble_members where bubble_id = p_bubble_id and user_id = v_user and left_at is null)
  then raise exception 'not_bubble_member'; end if;
  update public.buddy_virtual_walks w set status = 'ended', ended_at = now()
  where w.bubble_id = p_bubble_id and w.status in ('ringing', 'active') and (
    not coalesce(v_open, false)
    or (w.status = 'ringing' and w.created_at <= now() - interval '90 seconds')
    or (w.status = 'active' and (w.callee_id is null
      or least(w.caller_heartbeat_at, coalesce(w.callee_heartbeat_at, w.created_at)) <= now() - interval '45 seconds'))
    or not exists (select 1 from public.buddy_bubble_members m join public.profiles p on p.id = m.user_id
      where m.bubble_id = w.bubble_id and m.user_id = w.caller_id and m.left_at is null and p.role = 'user' and p.verification_status <> 'suspended')
    or (w.status = 'active' and not exists (select 1 from public.buddy_bubble_members m join public.profiles p on p.id = m.user_id
      where m.bubble_id = w.bubble_id and m.user_id = w.callee_id and m.left_at is null and p.role = 'user' and p.verification_status <> 'suspended'))
  );
  return coalesce(v_open, false);
end; $$;

create function public.start_buddy_virtual_walk(p_bubble_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_walk public.buddy_virtual_walks; v_user uuid := auth.uid();
begin
  if not public.buddy_audio_prepare(p_bubble_id) then return jsonb_build_object('error', 'bubble_closed'); end if;
  if (select count(*) from public.buddy_bubble_members m join public.profiles p on p.id = m.user_id
    where m.bubble_id = p_bubble_id and m.left_at is null and p.role = 'user' and p.verification_status <> 'suspended') < 2
  then return jsonb_build_object('error', 'waiting_for_buddy'); end if;
  if exists (select 1 from public.buddy_virtual_walks where bubble_id = p_bubble_id and status in ('ringing', 'active'))
  then return jsonb_build_object('error', 'call_already_live'); end if;
  insert into public.buddy_virtual_walks(bubble_id, caller_id, status) values(p_bubble_id, v_user, 'ringing') returning * into v_walk;
  insert into public.buddy_audit_events(bubble_id, actor_id, event) values(p_bubble_id, v_user, 'virtual_walk_started');
  return jsonb_build_object('id', v_walk.id, 'status', v_walk.status, 'callerId', v_walk.caller_id, 'calleeId', null);
end; $$;

create function public.answer_buddy_virtual_walk(p_bubble_id uuid, p_walk_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_walk public.buddy_virtual_walks; v_user uuid := auth.uid();
begin
  if not public.buddy_audio_prepare(p_bubble_id) then return jsonb_build_object('error', 'bubble_closed'); end if;
  update public.buddy_virtual_walks set status = 'active', callee_id = v_user, answered_at = now(),
    last_heartbeat_at = now(), caller_heartbeat_at = now(), callee_heartbeat_at = now()
  where id = p_walk_id and bubble_id = p_bubble_id and status = 'ringing' and caller_id <> v_user returning * into v_walk;
  if not found then return jsonb_build_object('error', 'call_already_answered_or_ended'); end if;
  insert into public.buddy_audit_events(bubble_id, actor_id, event) values(p_bubble_id, v_user, 'virtual_walk_answered');
  return jsonb_build_object('id', v_walk.id, 'status', v_walk.status, 'callerId', v_walk.caller_id, 'calleeId', v_walk.callee_id);
end; $$;

create function public.end_buddy_virtual_walk(p_bubble_id uuid, p_walk_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform public.buddy_audio_prepare(p_bubble_id);
  update public.buddy_virtual_walks set status = 'ended', ended_at = now()
  where id = p_walk_id and bubble_id = p_bubble_id and status in ('ringing', 'active') and (caller_id = v_user or callee_id = v_user);
  if found then
    insert into public.buddy_audit_events(bubble_id, actor_id, event) values(p_bubble_id, v_user, 'virtual_walk_ended');
  elsif not exists (select 1 from public.buddy_virtual_walks where id = p_walk_id and bubble_id = p_bubble_id
    and status = 'ended' and (caller_id = v_user or callee_id = v_user))
  then return jsonb_build_object('error', 'not_call_participant'); end if;
  return jsonb_build_object('id', p_walk_id, 'status', 'ended');
end; $$;

create function public.heartbeat_buddy_virtual_walk(p_bubble_id uuid, p_walk_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if not public.buddy_audio_prepare(p_bubble_id) then return jsonb_build_object('error', 'bubble_closed'); end if;
  update public.buddy_virtual_walks set last_heartbeat_at = now(),
    caller_heartbeat_at = case when caller_id = v_user then now() else caller_heartbeat_at end,
    callee_heartbeat_at = case when callee_id = v_user then now() else callee_heartbeat_at end
  where id = p_walk_id and bubble_id = p_bubble_id and status in ('ringing', 'active') and (caller_id = v_user or callee_id = v_user);
  if not found then return jsonb_build_object('error', 'call_ended'); end if;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.read_buddy_bubble(p_bubble_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_stale boolean;
begin
  select exists (select 1 from public.buddy_virtual_walks w where w.bubble_id = p_bubble_id and w.status in ('ringing', 'active')
    and (w.created_at <= now() - interval '90 seconds' and w.status = 'ringing'
      or w.status = 'active' and (w.callee_id is null or least(w.caller_heartbeat_at, coalesce(w.callee_heartbeat_at, w.created_at)) <= now() - interval '45 seconds')))
  into v_stale;
  perform public.buddy_audio_prepare(p_bubble_id);
  select jsonb_build_object(
    'meetingCode', b.meeting_code, 'closed', b.closed_at is not null or b.expires_at <= now(), 'expiresAt', b.expires_at, 'stale', v_stale,
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'arrived', m.arrived_at is not null,
      'met', m.met_confirmed_at is not null) order by m.created_at)
      from public.buddy_bubble_members m where m.bubble_id = b.id and m.left_at is null), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('senderId', msg.sender_id, 'messageKey', msg.message_key,
      'createdAt', msg.created_at) order by msg.created_at desc)
      from (select sender_id, message_key, created_at from public.buddy_bubble_messages where bubble_id = b.id order by created_at desc limit 20) msg), '[]'::jsonb),
    'virtualWalk', (select jsonb_build_object('id', w.id, 'status', w.status, 'callerId', w.caller_id,
      'calleeId', w.callee_id, 'stale', false) from public.buddy_virtual_walks w where w.bubble_id = b.id and w.status in ('ringing', 'active'))
  ) into v_result from public.buddy_bubbles b where b.id = p_bubble_id;
  if v_result is null then raise exception 'bubble_not_found'; end if;
  return v_result;
end; $$;

create function public.buddy_can_use_audio_topic(p_topic text, p_send boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.buddy_virtual_walks w join public.buddy_bubbles b on b.id = w.bubble_id
    join public.buddy_bubble_members m on m.bubble_id = b.id and m.user_id = auth.uid() and m.left_at is null
    join public.profiles p on p.id = m.user_id and p.role = 'user' and p.verification_status <> 'suspended'
    where b.closed_at is null and b.expires_at > now() and w.status = 'active'
      and w.callee_id is not null and auth.uid() in (w.caller_id, w.callee_id)
      and least(w.caller_heartbeat_at, coalesce(w.callee_heartbeat_at, w.created_at)) > now() - interval '45 seconds'
      and exists (select 1 from public.buddy_bubble_members peer join public.profiles pp on pp.id = peer.user_id
        where peer.bubble_id = b.id and peer.user_id = case when auth.uid() = w.caller_id then w.callee_id else w.caller_id end
        and peer.left_at is null and pp.role = 'user' and pp.verification_status <> 'suspended')
      and (p_topic = 'buddy-audio:' || b.id::text || ':' || w.id::text || ':' || auth.uid()::text
        or (not coalesce(p_send, true) and p_topic = 'buddy-audio:' || b.id::text || ':' || w.id::text || ':' ||
          (case when auth.uid() = w.caller_id then w.callee_id else w.caller_id end)::text))
  );
$$;

create function public.buddy_audio_close_invalid() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'buddy_bubbles' then
    update public.buddy_virtual_walks set status = 'ended', ended_at = now()
    where bubble_id = new.id and status in ('ringing', 'active') and (new.closed_at is not null or new.expires_at <= now());
  else
    update public.buddy_virtual_walks set status = 'ended', ended_at = now()
    where bubble_id = new.bubble_id and status in ('ringing', 'active') and new.left_at is not null
      and (caller_id = new.user_id or callee_id = new.user_id);
  end if;
  return new;
end; $$;
create trigger buddy_audio_bubble_closed after update of closed_at, expires_at on public.buddy_bubbles
for each row execute function public.buddy_audio_close_invalid();
create trigger buddy_audio_member_left after update of left_at on public.buddy_bubble_members
for each row execute function public.buddy_audio_close_invalid();

revoke all on function public.buddy_audio_prepare(uuid), public.buddy_audio_close_invalid() from public, anon, authenticated;
revoke all on function public.start_buddy_virtual_walk(uuid), public.answer_buddy_virtual_walk(uuid, uuid),
  public.end_buddy_virtual_walk(uuid, uuid), public.heartbeat_buddy_virtual_walk(uuid, uuid),
  public.buddy_can_use_audio_topic(text, boolean), public.read_buddy_bubble(uuid) from public, anon;
grant execute on function public.start_buddy_virtual_walk(uuid), public.answer_buddy_virtual_walk(uuid, uuid),
  public.end_buddy_virtual_walk(uuid, uuid), public.heartbeat_buddy_virtual_walk(uuid, uuid),
  public.buddy_can_use_audio_topic(text, boolean), public.read_buddy_bubble(uuid) to authenticated;

create policy buddy_audio_receive on realtime.messages for select to authenticated
using (extension = 'broadcast' and public.buddy_can_use_audio_topic(realtime.topic(), false));
create policy buddy_audio_send on realtime.messages for insert to authenticated
with check (extension = 'broadcast' and public.buddy_can_use_audio_topic(realtime.topic(), true));