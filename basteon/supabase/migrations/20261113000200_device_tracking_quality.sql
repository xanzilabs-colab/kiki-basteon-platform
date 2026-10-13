alter table public.devices
  add column if not exists last_hdop numeric(4,1)
    check (last_hdop is null or last_hdop between 0 and 99),
  add column if not exists last_satellites smallint
    check (last_satellites is null or last_satellites >= 0),
  add column if not exists last_speed_kmh numeric(6,1)
    check (last_speed_kmh is null or last_speed_kmh between 0 and 400),
  add column if not exists last_heading_deg smallint
    check (last_heading_deg is null or last_heading_deg between 0 and 359);
