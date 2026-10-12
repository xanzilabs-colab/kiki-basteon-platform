alter table public.devices
  add column if not exists is_virtual boolean not null default false;

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated
using (
  (not is_virtual and user_id = auth.uid())
  or public.is_admin()
  or exists (
    select 1
    from public.alerts a
    where a.device_id = devices.device_id
      and a.status not in ('resolved', 'false_alarm')
      and public.can_access_alert(a.id)
  )
);

create table if not exists public.trigger_virtual_endpoints (
  token_id uuid primary key references public.trigger_tokens(id) on delete cascade,
  device_id text not null unique references public.devices(device_id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.trigger_virtual_endpoints enable row level security;
revoke all on public.trigger_virtual_endpoints from public, anon, authenticated;
grant all on public.trigger_virtual_endpoints to service_role;

do $$
declare
  t record;
  v_device_id text;
begin
  for t in
    select id, user_id
    from public.trigger_tokens
    where kind = 'android_shell'
  loop
    v_device_id := 'TRIGGER-' || replace(t.id::text, '-', '');
    insert into public.devices (device_id, user_id, device_name, active, last_ctr, is_virtual)
    values (v_device_id, t.user_id, 'Phone safety trigger', true, 0, true)
    on conflict (device_id) do update
      set is_virtual = true, user_id = excluded.user_id, device_name = excluded.device_name;
    insert into public.trigger_virtual_endpoints (token_id, device_id, user_id)
    values (t.id, v_device_id, t.user_id)
    on conflict (token_id) do nothing;
  end loop;
end
$$;

create or replace function public.trigger_pending_cancel_user(p_user_id uuid, p_pending_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pending_alerts%rowtype;
begin
  if p_user_id is null or p_pending_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select *
  into p
  from public.pending_alerts
  where id = p_pending_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('ok', false); end if;

  if p.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  if p.promoted_alert_id is not null or p.activates_at <= now() then
    return jsonb_build_object('ok', false);
  end if;

  update public.pending_alerts
  set cancelled_at = now()
  where id = p.id and user_id = p_user_id
  returning * into p;

  insert into public.trigger_events (token_id, user_id, kind, reason, pending_id)
  values (p.token_id, p_user_id, 'cancel', 'user_cancelled', p.id);
  return jsonb_build_object('ok', true, 'cancelled', true);
end;
$$;

revoke all on function public.trigger_pending_cancel_user(uuid,uuid) from public, anon, authenticated;
grant execute on function public.trigger_pending_cancel_user(uuid,uuid) to service_role;
