-- Emergency types: tap = SOS, hold and slide = Medical.
-- The type is extra information. It must never be able to block an alert.

-- ---------- catalogue ----------
create table public.emergency_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null check (length(label) between 2 and 60),
  short_label text not null check (length(short_label) between 2 and 16),
  icon text not null,
  tone text not null check (tone in ('danger','medical','warning','info')),
  life_threat boolean not null default true,
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.emergency_types enable row level security;
create policy emergency_types_read on public.emergency_types
  for select to authenticated using (true);
revoke all on public.emergency_types from anon, authenticated;
grant select on public.emergency_types to authenticated;

insert into public.emergency_types (code, label, short_label, icon, tone, life_threat, sort_order) values
  ('sos', 'SOS: I''m in danger', 'SOS', 'siren', 'danger', true, 0),
  ('medical', 'Medical emergency', 'Medical', 'heart-pulse', 'medical', true, 1)
on conflict (code) do nothing;

-- ---------- resolver: anything unknown, empty or inactive becomes 'sos' ----------
create or replace function public.resolve_emergency_type(p_type text)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select t.code from public.emergency_types t
      where t.code = lower(btrim(p_type)) and t.active),
    'sos')
$$;

revoke all on function public.resolve_emergency_type(text) from public, anon;
grant execute on function public.resolve_emergency_type(text) to authenticated, service_role;

-- Existing alerts become SOS / legacy; new phone requests default to tap.
alter table public.alerts
  add column if not exists type_code text not null default 'sos'
    references public.emergency_types(code),
  add column if not exists type_source text not null default 'legacy'
    check (type_source in ('legacy','tap','hold_slide','device','upgrade')),
  add column if not exists type_updated_at timestamptz;

alter table public.alerts alter column type_source set default 'tap';
create index if not exists alerts_type_code_idx on public.alerts (type_code);

-- ---------- safety net: whatever path inserts an alert, the type is always valid ----------
create or replace function public.alerts_coerce_type()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.type_code := public.resolve_emergency_type(new.type_code);
  return new;
end $$;

create trigger alerts_coerce_type_trg
  before insert or update of type_code on public.alerts
  for each row execute function public.alerts_coerce_type();

-- ---------- switch the type while the alert is live (device owner only) ----------
create or replace function public.alert_set_type(p_alert uuid, p_type text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_type text := public.resolve_emergency_type(p_type);
  v_old text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select a.type_code into v_old
    from public.alerts a
    join public.devices d on d.device_id = a.device_id
   where a.id = p_alert
     and d.user_id = v_uid
     and a.status in ('new','acknowledged','enroute','on_scene')
   for update of a;
  if not found then raise exception 'alert_not_found'; end if;

  if v_old = v_type then return v_type; end if;

  update public.alerts
     set type_code = v_type, type_source = 'upgrade', type_updated_at = now()
   where id = p_alert;

  return v_type;
end $$;

revoke all on function public.alert_set_type(uuid, text) from public, anon;
grant execute on function public.alert_set_type(uuid, text) to authenticated;