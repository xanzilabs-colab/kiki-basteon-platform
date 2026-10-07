-- Keep the private encrypted-media bucket and entry metadata limits in sync.
alter table public.journal_entries
  drop constraint if exists journal_entries_media_bytes_check;

alter table public.journal_entries
  add constraint journal_entries_media_bytes_check
  check (media_bytes between 0 and 26214400);

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['application/octet-stream']
where id = 'journal-media';