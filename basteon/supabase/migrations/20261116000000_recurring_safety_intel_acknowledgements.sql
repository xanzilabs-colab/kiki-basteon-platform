alter table public.safety_intel_alert_log
  add column if not exists reminder_slot bigint;

update public.safety_intel_alert_log
set reminder_slot = floor(extract(epoch from sent_at) / 300)::bigint
where reminder_slot is null;

alter table public.safety_intel_alert_log
  alter column reminder_slot set not null;

delete from public.safety_intel_alert_log older
using public.safety_intel_alert_log newer
where older.user_id = newer.user_id
  and older.record_id = newer.record_id
  and older.reminder_slot = newer.reminder_slot
  and older.id < newer.id;

create unique index if not exists safety_intel_alert_log_reminder_slot_idx
  on public.safety_intel_alert_log (user_id, record_id, reminder_slot);

create table if not exists public.safety_intel_alert_acknowledgements (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.community_intel_records(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
alter table public.safety_intel_alert_acknowledgements enable row level security;
revoke all on public.safety_intel_alert_acknowledgements from anon, authenticated;
