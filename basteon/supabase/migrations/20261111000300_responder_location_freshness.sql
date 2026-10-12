begin;

alter table public.responder_presence
  add column if not exists last_location_at timestamptz;

update public.responder_presence
set last_location_at = last_seen_at
where last_lat is not null
  and last_lng is not null
  and last_location_at is null;

create or replace function public.set_responder_presence_location_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.last_lat is not null and new.last_lng is not null then
      new.last_location_at := now();
    else
      new.last_location_at := null;
    end if;
  elsif new.last_lat is null or new.last_lng is null then
    new.last_location_at := null;
  elsif old.last_lat is distinct from new.last_lat
    or old.last_lng is distinct from new.last_lng then
    new.last_location_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists responder_presence_location_at on public.responder_presence;
create trigger responder_presence_location_at
before insert or update on public.responder_presence
for each row execute function public.set_responder_presence_location_at();

commit;
