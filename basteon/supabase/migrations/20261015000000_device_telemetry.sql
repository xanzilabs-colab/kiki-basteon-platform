alter table public.devices
  add column if not exists battery smallint,
  add column if not exists wifi_rssi smallint,
  add column if not exists telemetry_at timestamptz;

alter table public.devices
  drop constraint if exists devices_battery_range,
  add constraint devices_battery_range check (battery is null or battery between 0 and 100);