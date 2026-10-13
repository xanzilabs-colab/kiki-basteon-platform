alter table public.device_security_events
  drop constraint if exists device_security_events_event_check;

alter table public.device_security_events
  add constraint device_security_events_event_check check (event in (
    'pin_set', 'pin_changed', 'pin_removed', 'pin_failed', 'pin_locked_out',
    'unlinked', 'transfer_authorized', 'transferred', 'admin_pin_reset', 'admin_lockout_cleared',
    'admin_owner_changed', 'admin_device_key_rotated'
  ));
