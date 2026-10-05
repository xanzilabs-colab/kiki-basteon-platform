-- Kiki Journal core: encrypted garden journal. All user content is ciphertext.
-- Writes are restricted to the journal RPCs below; media is encrypted before upload.

create or replace function public.journal_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create table public.journal_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kdf text not null default 'pbkdf2-sha256' check (kdf = 'pbkdf2-sha256'),
  kdf_iterations integer not null check (kdf_iterations between 200000 and 5000000),
  salt text not null check (length(salt) between 16 and 128),
  wrapped_dek text not null check (length(wrapped_dek) between 40 and 512),
  wrap_iv text not null check (length(wrap_iv) between 8 and 64),
  recovery_wrapped_dek text check (recovery_wrapped_dek is null or length(recovery_wrapped_dek) between 40 and 512),
  recovery_iv text check (recovery_iv is null or length(recovery_iv) between 8 and 64),
  key_version smallint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.journal_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  world text not null default 'garden' check (world in ('garden','stoep','rooftop','koppie','balcony')),
  auto_lock_seconds integer not null default 60 check (auto_lock_seconds between 15 and 900),
  last_prompt_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.journal_chapters (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  title_enc text not null check (length(title_enc) between 20 and 2048),
  title_iv text not null check (length(title_iv) between 8 and 64),
  sort_order integer not null default 0, started_at timestamptz not null default now(),
  closed_at timestamptz, created_at timestamptz not null default now()
);
create index journal_chapters_user_sort on public.journal_chapters (user_id, sort_order);
create unique index journal_one_open_chapter on public.journal_chapters (user_id) where closed_at is null;
create table public.journal_entries (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('moment','voice','thought','feeling')),
  symbol text not null check (symbol in ('flower','stone','star','butterfly','key','lantern','cloud')),
  chapter_id uuid references public.journal_chapters(id) on delete set null,
  privacy text not null default 'only_me' check (privacy in ('only_me','kiki_can_read')),
  payload_enc text not null check (length(payload_enc) between 20 and 65536),
  payload_iv text not null check (length(payload_iv) between 8 and 64), enc_version smallint not null default 1,
  media_path text, media_bytes integer not null default 0 check (media_bytes between 0 and 6291456),
  occurred_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint journal_media_matches_kind check ((kind in ('moment','voice') and media_path is not null and media_bytes > 0) or (kind in ('thought','feeling') and media_path is null and media_bytes = 0))
);
create index journal_entries_user_time on public.journal_entries (user_id, occurred_at desc);
create index journal_entries_user_chapter on public.journal_entries (user_id, chapter_id);
create trigger journal_keys_touch before update on public.journal_keys for each row execute function public.journal_touch_updated_at();
create trigger journal_settings_touch before update on public.journal_settings for each row execute function public.journal_touch_updated_at();
create trigger journal_entries_touch before update on public.journal_entries for each row execute function public.journal_touch_updated_at();

alter table public.journal_keys enable row level security;
alter table public.journal_settings enable row level security;
alter table public.journal_chapters enable row level security;
alter table public.journal_entries enable row level security;
create policy journal_keys_select_own on public.journal_keys for select to authenticated using (user_id = (select auth.uid()));
create policy journal_settings_select_own on public.journal_settings for select to authenticated using (user_id = (select auth.uid()));
create policy journal_chapters_select_own on public.journal_chapters for select to authenticated using (user_id = (select auth.uid()));
create policy journal_entries_select_own on public.journal_entries for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.journal_keys, public.journal_settings, public.journal_chapters, public.journal_entries from anon, authenticated;
grant select on public.journal_keys, public.journal_settings, public.journal_chapters, public.journal_entries to authenticated;

create or replace function public.journal_setup_keys(p_kdf_iterations integer, p_salt text, p_wrapped_dek text, p_wrap_iv text, p_recovery_wrapped_dek text default null, p_recovery_iv text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.journal_keys where user_id = v_uid) then raise exception 'already_set_up'; end if;
  insert into public.journal_keys (user_id,kdf_iterations,salt,wrapped_dek,wrap_iv,recovery_wrapped_dek,recovery_iv) values (v_uid,p_kdf_iterations,p_salt,p_wrapped_dek,p_wrap_iv,p_recovery_wrapped_dek,p_recovery_iv);
  insert into public.journal_settings (user_id) values (v_uid) on conflict do nothing;
end $$;
create or replace function public.journal_rewrap_keys(p_kdf_iterations integer, p_salt text, p_wrapped_dek text, p_wrap_iv text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.journal_keys set kdf_iterations=p_kdf_iterations,salt=p_salt,wrapped_dek=p_wrapped_dek,wrap_iv=p_wrap_iv where user_id=v_uid;
  if not found then raise exception 'journal_not_set_up'; end if;
end $$;
create or replace function public.journal_set_recovery(p_recovery_wrapped_dek text, p_recovery_iv text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.journal_keys set recovery_wrapped_dek=p_recovery_wrapped_dek,recovery_iv=p_recovery_iv where user_id=v_uid;
  if not found then raise exception 'journal_not_set_up'; end if;
end $$;
create or replace function public.journal_create_chapter(p_id uuid,p_title_enc text,p_title_iv text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_count integer; v_order integer; begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.journal_keys where user_id=v_uid) then raise exception 'journal_not_set_up'; end if;
  select count(*) into v_count from public.journal_chapters where user_id=v_uid; if v_count>=50 then raise exception 'too_many_chapters'; end if;
  update public.journal_chapters set closed_at=now() where user_id=v_uid and closed_at is null;
  select coalesce(max(sort_order),-1)+1 into v_order from public.journal_chapters where user_id=v_uid;
  insert into public.journal_chapters (id,user_id,title_enc,title_iv,sort_order) values (p_id,v_uid,p_title_enc,p_title_iv,v_order);
end $$;
create or replace function public.journal_update_chapter(p_id uuid,p_title_enc text default null,p_title_iv text default null,p_close boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.journal_chapters set title_enc=coalesce(p_title_enc,title_enc),title_iv=coalesce(p_title_iv,title_iv),closed_at=case when p_close then coalesce(closed_at,now()) else closed_at end where id=p_id and user_id=v_uid;
  if not found then raise exception 'chapter_not_found'; end if;
end $$;
create or replace function public.journal_delete_chapter(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); begin if v_uid is null then raise exception 'not_authenticated'; end if; delete from public.journal_chapters where id=p_id and user_id=v_uid; if not found then raise exception 'chapter_not_found'; end if; end $$;
create or replace function public.journal_create_entry(p_id uuid,p_kind text,p_symbol text,p_chapter_id uuid,p_payload_enc text,p_payload_iv text,p_media_path text default null,p_media_bytes integer default 0,p_occurred_at timestamptz default now())
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_used bigint; v_occurred timestamptz:=coalesce(p_occurred_at,now()); v_created timestamptz; begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.journal_keys where user_id=v_uid) then raise exception 'journal_not_set_up'; end if;
  if v_occurred > now()+interval '5 minutes' or v_occurred<timestamptz '2000-01-01' then raise exception 'invalid_input'; end if;
  if p_chapter_id is not null and not exists (select 1 from public.journal_chapters where id=p_chapter_id and user_id=v_uid) then raise exception 'chapter_not_found'; end if;
  if p_media_path is not null and not starts_with(p_media_path,v_uid::text||'/'||p_id::text||'/') then raise exception 'invalid_input'; end if;
  select coalesce(sum(media_bytes),0) into v_used from public.journal_entries where user_id=v_uid; if v_used+coalesce(p_media_bytes,0)>209715200 then raise exception 'quota_exceeded'; end if;
  begin insert into public.journal_entries (id,user_id,kind,symbol,chapter_id,payload_enc,payload_iv,media_path,media_bytes,occurred_at) values (p_id,v_uid,p_kind,p_symbol,p_chapter_id,p_payload_enc,p_payload_iv,p_media_path,coalesce(p_media_bytes,0),v_occurred) returning created_at into v_created; exception when unique_violation then raise exception 'entry_exists'; end;
  return v_created;
end $$;
create or replace function public.journal_update_entry(p_id uuid,p_symbol text,p_chapter_id uuid,p_payload_enc text,p_payload_iv text,p_occurred_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_occurred_at>now()+interval '5 minutes' or p_occurred_at<timestamptz '2000-01-01' then raise exception 'invalid_input'; end if;
  if p_chapter_id is not null and not exists (select 1 from public.journal_chapters where id=p_chapter_id and user_id=v_uid) then raise exception 'chapter_not_found'; end if;
  update public.journal_entries set symbol=p_symbol,chapter_id=p_chapter_id,payload_enc=p_payload_enc,payload_iv=p_payload_iv,occurred_at=p_occurred_at where id=p_id and user_id=v_uid;
  if not found then raise exception 'entry_not_found'; end if;
end $$;
create or replace function public.journal_delete_entry(p_id uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_path text; begin if v_uid is null then raise exception 'not_authenticated'; end if; delete from public.journal_entries where id=p_id and user_id=v_uid returning media_path into v_path; if not found then raise exception 'entry_not_found'; end if; return v_path; end $$;
create or replace function public.journal_update_settings(p_auto_lock_seconds integer default null,p_world text default null) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); begin if v_uid is null then raise exception 'not_authenticated'; end if; update public.journal_settings set auto_lock_seconds=coalesce(p_auto_lock_seconds,auto_lock_seconds),world=coalesce(p_world,world) where user_id=v_uid; if not found then raise exception 'journal_not_set_up'; end if; end $$;
create or replace function public.journal_mark_prompt_shown(p_local_date date) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); begin if v_uid is null then raise exception 'not_authenticated'; end if; if abs(p_local_date-(now() at time zone 'utc')::date)>1 then raise exception 'invalid_input'; end if; update public.journal_settings set last_prompt_date=p_local_date where user_id=v_uid; end $$;
create or replace function public.journal_usage() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_bytes bigint; v_count bigint; begin if v_uid is null then raise exception 'not_authenticated'; end if; select coalesce(sum(media_bytes),0),count(*) into v_bytes,v_count from public.journal_entries where user_id=v_uid; return jsonb_build_object('used_bytes',v_bytes,'entry_count',v_count,'quota_bytes',209715200); end $$;
create or replace function public.journal_reset_all() returns text[] language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_paths text[]; begin if v_uid is null then raise exception 'not_authenticated'; end if; select coalesce(array_agg(media_path) filter (where media_path is not null),'{}') into v_paths from public.journal_entries where user_id=v_uid; delete from public.journal_entries where user_id=v_uid; delete from public.journal_chapters where user_id=v_uid; delete from public.journal_settings where user_id=v_uid; delete from public.journal_keys where user_id=v_uid; return v_paths; end $$;
do $$ declare r record; begin for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'journal\_%' escape '\' and p.proname<>'journal_touch_updated_at' loop execute format('revoke all on function %s from public, anon',r.sig); execute format('grant execute on function %s to authenticated',r.sig); end loop; end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('journal-media','journal-media',false,6291456,array['application/octet-stream']) on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy journal_media_insert_own on storage.objects for insert to authenticated with check (bucket_id='journal-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy journal_media_select_own on storage.objects for select to authenticated using (bucket_id='journal-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy journal_media_delete_own on storage.objects for delete to authenticated using (bucket_id='journal-media' and (storage.foldername(name))[1]=(select auth.uid())::text);