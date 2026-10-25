create or replace function public.account_delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fk record;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'account_not_found';
  end if;

  delete from public.linkup_matches
  where player1_id = p_user_id
     or player2_id = p_user_id
     or holder_id = p_user_id
     or passer_id = p_user_id;

  delete from public.buddy_community_alerts where reporter_id = p_user_id;
  delete from public.community_intel_records where reporter_id = p_user_id;

  update public.devices
  set device_name = 'Secure Panic Unit',
      notes = null
  where user_id = p_user_id;

  for v_fk in
    select
      child_ns.nspname as child_schema,
      child.relname as child_table,
      child_att.attname as child_column,
      constraint_row.confdeltype as delete_action
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as child on child.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as child_ns on child_ns.oid = child.relnamespace
    join lateral unnest(constraint_row.conkey) as child_key(attnum) on true
    join pg_catalog.pg_attribute as child_att
      on child_att.attrelid = child.oid and child_att.attnum = child_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and constraint_row.confdeltype in ('c', 'n')
      and child_ns.nspname = 'public'
      and child.oid <> 'public.profiles'::regclass
  loop
    if v_fk.delete_action = 'c' then
      execute pg_catalog.format(
        'delete from %I.%I where %I = $1',
        v_fk.child_schema,
        v_fk.child_table,
        v_fk.child_column
      ) using p_user_id;
    else
      execute pg_catalog.format(
        'update %I.%I set %I = null where %I = $1',
        v_fk.child_schema,
        v_fk.child_table,
        v_fk.child_column,
        v_fk.child_column
      ) using p_user_id;
    end if;
  end loop;

  update public.profiles
  set full_name = null,
      phone = null,
      home_address = null,
      emergency_contact_name = null,
      emergency_contact_phone = null,
      avatar_path = null,
      ringtone_path = null,
      ringtone_id = null,
      dark_theme = false,
      safety_pin_set_at = null
  where id = p_user_id;

  update auth.users
  set raw_user_meta_data = '{}'::jsonb,
      phone = null,
      updated_at = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.account_delete_user_data(uuid) from public, anon, authenticated;
grant execute on function public.account_delete_user_data(uuid) to service_role;
