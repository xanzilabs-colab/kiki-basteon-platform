alter table public.devices
  alter column device_name set default 'Kiki band';

alter table public.device_link_tokens
  add column if not exists nickname text;

create or replace function public.claim_device_with_token(
  p_device_id text,
  p_token_hash text,
  p_ctr bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link_token public.device_link_tokens%rowtype;
  target_device public.devices%rowtype;
  token_exists boolean;
begin
  select * into link_token from public.device_link_tokens where token_hash = p_token_hash for update;
  token_exists := found;
  select * into target_device from public.devices where device_id = p_device_id for update;
  if not found then return jsonb_build_object('linked', false, 'reason', 'wrong_device'); end if;

  if token_exists and link_token.used_at is not null then
    if link_token.used_by_device = p_device_id and target_device.user_id = link_token.user_id then
      return jsonb_build_object('linked', true);
    end if;
    return jsonb_build_object('linked', false, 'reason', 'used');
  end if;

  if p_ctr <= target_device.last_ctr then return jsonb_build_object('linked', false, 'reason', 'replayed'); end if;
  update public.devices set last_ctr = p_ctr, last_seen_at = now() where device_id = p_device_id;

  if not token_exists then return jsonb_build_object('linked', false, 'reason', 'not_found'); end if;
  if link_token.device_id <> p_device_id then return jsonb_build_object('linked', false, 'reason', 'wrong_device'); end if;
  if link_token.expires_at <= now() then return jsonb_build_object('linked', false, 'reason', 'expired'); end if;
  if target_device.user_id is not null and target_device.user_id <> link_token.user_id then
    return jsonb_build_object('linked', false, 'reason', 'already_owned');
  end if;

  update public.devices
  set
    user_id = link_token.user_id,
    linked_at = now(),
    device_name = coalesce(nullif(left(trim(link_token.nickname), 40), ''), device_name)
  where device_id = p_device_id;

  update public.device_link_tokens
  set used_at = now(), used_by_device = p_device_id
  where id = link_token.id;

  return jsonb_build_object('linked', true);
end;
$$;

revoke execute on function public.claim_device_with_token(text, text, bigint) from public, anon, authenticated;
grant execute on function public.claim_device_with_token(text, text, bigint) to service_role;