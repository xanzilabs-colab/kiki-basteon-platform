alter table public.linkup_matches
  add column if not exists bot_actor_id text;

update public.linkup_matches
set bot_actor_id = 'kiki'
where vs_bot and bot_actor_id is null;

alter table public.linkup_rounds
  add column if not exists sudden_death boolean not null default false;

alter table public.linkup_answers
  add column if not exists actor_id text;

update public.linkup_answers a
set actor_id = coalesce(
  a.user_id::text,
  m.bot_actor_id,
  'legacy:' || a.id::text
)
from public.linkup_rounds r
join public.linkup_matches m on m.id = r.match_id
where a.round_id = r.id
  and a.actor_id is null;

update public.linkup_answers
set actor_id = 'legacy:' || id::text
where actor_id is null;

alter table public.linkup_answers
  alter column actor_id set not null;

create unique index if not exists linkup_answers_round_id_actor_id_key
  on public.linkup_answers (round_id, actor_id);

alter table public.linkup_turns
  add column if not exists actor_id text;

update public.linkup_turns t
set actor_id = coalesce(
  t.holder_id::text,
  m.bot_actor_id,
  'legacy:' || t.id::text
)
from public.linkup_matches m
where t.match_id = m.id
  and t.actor_id is null;

update public.linkup_turns
set actor_id = 'legacy:' || id::text
where actor_id is null;

alter table public.linkup_turns
  alter column actor_id set not null;
