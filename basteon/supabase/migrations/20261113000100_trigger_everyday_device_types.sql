alter table public.trigger_devices
  drop constraint if exists trigger_devices_kind_check;

alter table public.trigger_devices
  add constraint trigger_devices_kind_check
  check (kind in (
    'earbuds',
    'wired',
    'car',
    'speaker',
    'helmet',
    'glasses',
    'ring',
    'pedal',
    'keyboard',
    'watch'
  ));
