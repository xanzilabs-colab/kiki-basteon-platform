alter table public.game_rooms
  alter column state set default
  '{"board":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"turn":1,"phase":"place","placed":{"1":0,"2":0},"pendingRemoval":null,"winner":null}'::jsonb;

update public.game_rooms
set state = '{"board":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"turn":1,"phase":"place","placed":{"1":0,"2":0},"pendingRemoval":null,"winner":null}'::jsonb
where status in ('waiting', 'ready_check', 'playing')
  and (
    jsonb_typeof(state->'board') is distinct from 'array'
    or case
      when jsonb_typeof(state->'board') = 'array' then jsonb_array_length(state->'board') <> 24
      else false
    end
  );
