alter table public.journal_keys
  add column if not exists lock_type text not null default 'passphrase'
  check (lock_type in ('pin', 'passphrase'));

drop function if exists public.journal_setup_keys(integer, text, text, text, text, text);

create function public.journal_setup_keys(
  p_kdf_iterations integer,
  p_salt text,
  p_wrapped_dek text,
  p_wrap_iv text,
  p_recovery_wrapped_dek text default null,
  p_recovery_iv text default null,
  p_lock_type text default 'passphrase'
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_lock_type not in ('pin', 'passphrase') then raise exception 'invalid_input'; end if;
  if exists (select 1 from public.journal_keys where user_id = v_uid) then raise exception 'already_set_up'; end if;
  insert into public.journal_keys (user_id,kdf_iterations,salt,wrapped_dek,wrap_iv,recovery_wrapped_dek,recovery_iv,lock_type)
  values (v_uid,p_kdf_iterations,p_salt,p_wrapped_dek,p_wrap_iv,p_recovery_wrapped_dek,p_recovery_iv,p_lock_type);
  insert into public.journal_settings (user_id) values (v_uid) on conflict do nothing;
end $$;

revoke all on function public.journal_setup_keys(integer, text, text, text, text, text, text) from public, anon;
grant execute on function public.journal_setup_keys(integer, text, text, text, text, text, text) to authenticated;