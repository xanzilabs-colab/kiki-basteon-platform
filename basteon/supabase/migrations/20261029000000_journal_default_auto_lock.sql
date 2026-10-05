alter table public.journal_settings
  alter column auto_lock_seconds set default 300;

update public.journal_settings
set auto_lock_seconds = 300
where auto_lock_seconds = 60;