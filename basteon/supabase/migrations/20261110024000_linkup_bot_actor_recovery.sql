update public.linkup_matches
set bot_actor_id = 'kiki'
where vs_bot and bot_actor_id is null;

create or replace function public.linkup_set_bot_actor_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vs_bot and new.bot_actor_id is null then
    new.bot_actor_id := 'kiki';
  end if;
  return new;
end $$;

drop trigger if exists linkup_matches_bot_actor_id on public.linkup_matches;
create trigger linkup_matches_bot_actor_id
before insert or update of vs_bot, bot_actor_id on public.linkup_matches
for each row execute function public.linkup_set_bot_actor_id();
