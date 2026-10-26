create table public.responder_alert_dismissals (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index responder_alert_dismissals_user_idx
  on public.responder_alert_dismissals (user_id, dismissed_at desc);

alter table public.responder_alert_dismissals enable row level security;
revoke all on public.responder_alert_dismissals from public, anon, authenticated;
grant all on public.responder_alert_dismissals to service_role;
