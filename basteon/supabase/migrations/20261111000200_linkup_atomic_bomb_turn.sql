begin;

alter table public.linkup_answers
  alter column user_id drop not null;

create or replace function public.linkup_commit_bomb_turn(
  p_match_id uuid,
  p_expected_turn integer,
  p_expected_holder text,
  p_next_state jsonb,
  p_next_holder_id uuid,
  p_next_passer_id uuid,
  p_history_holder_id uuid,
  p_start text,
  p_end text,
  p_word text,
  p_valid boolean,
  p_reason text,
  p_used_ms integer,
  p_fuse_after_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.linkup_matches;
begin
  select * into v_match
  from public.linkup_matches
  where id = p_match_id
  for update;

  if v_match.id is null then raise exception 'match_not_found'; end if;
  if v_match.status <> 'active'
    or v_match.mode <> 'bomb'
    or v_match.turn_no <> p_expected_turn
    or v_match.bomb_state->>'holder' is distinct from p_expected_holder
    or v_match.bomb_state->>'end' is null then
    return false;
  end if;

  update public.linkup_matches
  set bomb_state = p_next_state,
      fuse_left_ms = greatest(0, p_fuse_after_ms),
      turn_no = p_expected_turn + 1,
      holder_id = p_next_holder_id,
      passer_id = p_next_passer_id,
      bomb_start = p_next_state->>'start',
      bomb_end = p_next_state->>'end',
      turn_started_at = now(),
      status = case when p_next_state->>'exploded' = 'true' then 'finished' else 'active' end,
      finished_at = case when p_next_state->>'exploded' = 'true' then now() else null end
  where id = p_match_id;

  insert into public.linkup_turns(
    match_id, turn_no, holder_id, actor_id, start, "end", word,
    valid, reason, used_ms, fuse_after_ms, resolved
  ) values (
    p_match_id, p_expected_turn, p_history_holder_id, p_expected_holder,
    p_start, p_end, coalesce(p_word, ''), p_valid, p_reason,
    greatest(0, p_used_ms), greatest(0, p_fuse_after_ms), true
  );

  return true;
end $$;

revoke all on function public.linkup_commit_bomb_turn(
  uuid, integer, text, jsonb, uuid, uuid, uuid, text, text, text, boolean, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.linkup_commit_bomb_turn(
  uuid, integer, text, jsonb, uuid, uuid, uuid, text, text, text, boolean, text, integer, integer
) to service_role;

commit;
