-- Restrict responder access to records associated with alerts they can access.

create or replace function public.can_access_trip(
  p_trip_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and p_user_id is not null
      and (
        t.owner_id = p_user_id
        or exists (
          select 1
          from public.profiles p
          where p.id = p_user_id
            and p.role = 'admin'
        )
        or (
          t.status in ('active', 'concern', 'alert')
          and exists (
            select 1
            from public.alerts a
            join public.devices d on d.device_id = a.device_id
            where d.user_id = t.owner_id
              and a.status not in ('resolved', 'false_alarm')
              and public.can_access_alert(a.id, p_user_id)
          )
        )
      )
  )
$$;

revoke all on function public.can_access_trip(uuid, uuid) from public, anon;
grant execute on function public.can_access_trip(uuid, uuid) to authenticated, service_role;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.devices d
      join public.alerts a on a.device_id = d.device_id
      where d.user_id = profiles.id
        and a.status not in ('resolved', 'false_alarm')
        and public.can_access_alert(a.id)
    )
  );

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.alerts a
      where a.device_id = devices.device_id
        and a.status not in ('resolved', 'false_alarm')
        and public.can_access_alert(a.id)
    )
  );

drop policy if exists alert_locations_staff_select on public.alert_locations;
create policy alert_locations_staff_select on public.alert_locations for select to authenticated
  using (public.can_access_alert(alert_id));

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (public.can_access_alert(id));

drop policy if exists alerts_staff_update on public.alerts;
create policy alerts_staff_update on public.alerts for update to authenticated
  using (public.is_admin() or (public.is_staff() and public.can_access_alert(id)))
  with check (public.is_admin() or (public.is_staff() and public.can_access_alert(id)));

drop policy if exists alert_events_select on public.alert_events;
create policy alert_events_select on public.alert_events for select to authenticated
  using (public.can_access_alert(alert_id));

drop policy if exists alert_events_staff_insert on public.alert_events;
create policy alert_events_staff_insert on public.alert_events for insert to authenticated
  with check (public.is_staff() and actor_id = auth.uid() and public.can_access_alert(alert_id));

drop policy if exists trips_owner_select on public.trips;
create policy trips_owner_select on public.trips for select to authenticated
  using (public.can_access_trip(id));

drop policy if exists trip_locations_owner_select on public.trip_locations;
create policy trip_locations_owner_select on public.trip_locations for select to authenticated
  using (public.can_access_trip(trip_id));

drop policy if exists trip_events_owner_select on public.trip_events;
create policy trip_events_owner_select on public.trip_events for select to authenticated
  using (public.can_access_trip(trip_id));

drop policy if exists "profile_image_owner_select" on storage.objects;
create policy "profile_image_owner_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'kiki-profile-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1
        from public.devices d
        join public.alerts a on a.device_id = d.device_id
        where d.user_id::text = (storage.foldername(name))[1]
          and a.status not in ('resolved', 'false_alarm')
          and public.can_access_alert(a.id)
      )
    )
  );
