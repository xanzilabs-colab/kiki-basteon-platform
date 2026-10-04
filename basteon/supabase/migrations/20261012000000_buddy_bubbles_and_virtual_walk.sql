-- Bubble messages and virtual-walk signalling are private safety records. No browser
-- client can query these tables directly; member-scoped APIs expose minimal views only.
create table public.buddy_bubble_messages (
  id bigint generated always as identity primary key,
  bubble_id uuid not null references public.buddy_bubbles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_key text not null check (message_key in ('on_my_way', 'at_the_meeting_point', 'running_late', 'i_need_help', 'i_arrived')),
  created_at timestamptz not null default now()
);
create index buddy_bubble_messages_recent on public.buddy_bubble_messages(bubble_id, created_at desc);

create table public.buddy_virtual_walks (
  id uuid primary key default gen_random_uuid(),
  bubble_id uuid not null references public.buddy_bubbles(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('ringing', 'active', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create unique index buddy_virtual_walks_one_live on public.buddy_virtual_walks(bubble_id) where status in ('ringing', 'active');

alter table public.buddy_bubble_messages enable row level security;
alter table public.buddy_virtual_walks enable row level security;
revoke all on public.buddy_bubble_messages, public.buddy_virtual_walks from anon, authenticated;