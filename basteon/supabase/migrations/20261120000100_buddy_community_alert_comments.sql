begin;

create table public.buddy_community_alert_comments (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.buddy_community_alerts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 2 and 300),
  created_at timestamptz not null default now()
);

create index buddy_community_alert_comments_alert_created
  on public.buddy_community_alert_comments(alert_id, created_at);

alter table public.buddy_community_alert_comments enable row level security;
revoke all on public.buddy_community_alert_comments from public, anon, authenticated;

create function public.list_community_alert_comment_counts(p_alert_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
begin
  if coalesce(cardinality(p_alert_ids), 0) > 100 then raise exception 'invalid_alert'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('alert_id', counts.alert_id, 'comment_count', counts.comment_count)), '[]'::jsonb)
    from (
      select a.id as alert_id, count(c.id)::integer as comment_count
      from (select distinct unnest(p_alert_ids) as id) requested
      join public.buddy_community_alerts a on a.id = requested.id
        and a.resolved_at is null and a.expires_at > now()
      left join public.buddy_community_alert_comments c on c.alert_id = a.id
      group by a.id
    ) counts
  );
end; $$;

create function public.list_community_alert_comments(p_alert_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.buddy_require_account();
begin
  if not exists (
    select 1 from public.buddy_community_alerts
    where id = p_alert_id and resolved_at is null and expires_at > now()
  ) then raise exception 'not_found'; end if;

  return jsonb_build_object(
    'comments',
    coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at) order by c.created_at)
      from public.buddy_community_alert_comments c
      where c.alert_id = p_alert_id
    ), '[]'::jsonb)
  );
end; $$;

create function public.add_community_alert_comment(p_user_id uuid, p_alert_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_body text;
  v_id uuid;
  v_created_at timestamptz;
begin
  select id into v_user from public.profiles
  where id = p_user_id and role = 'user' and verification_status is distinct from 'suspended';
  if v_user is null then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community_alert_comment:' || v_user::text, 0));
  if not exists (
    select 1 from public.buddy_community_alerts
    where id = p_alert_id and resolved_at is null and expires_at > now()
  ) then raise exception 'not_found'; end if;

  v_body := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
  v_body := regexp_replace(v_body, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'gi');
  v_body := regexp_replace(v_body, '(https?://[^[:space:]]+|www\.[^[:space:]]+)', '[link]', 'gi');
  v_body := regexp_replace(v_body, '@[[:alnum:]_]+', '[handle]', 'g');
  v_body := regexp_replace(v_body, '[+]?[0-9][0-9[:space:]().-]{6,}[0-9]', '[number]', 'g');
  if length(v_body) not between 2 and 300 then raise exception 'invalid_comment'; end if;
  if (
    select count(*) from public.buddy_community_alert_comments
    where author_id = v_user and created_at > now() - interval '1 hour'
  ) >= 30 then raise exception 'rate_limited'; end if;

  insert into public.buddy_community_alert_comments(alert_id, author_id, body)
  values (p_alert_id, v_user, v_body)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object('id', v_id, 'body', v_body, 'created_at', v_created_at);
end; $$;

revoke all on function public.list_community_alert_comment_counts(uuid[]),
  public.list_community_alert_comments(uuid),
  public.add_community_alert_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.list_community_alert_comment_counts(uuid[]),
  public.list_community_alert_comments(uuid) to authenticated;
grant execute on function public.add_community_alert_comment(uuid, uuid, text) to service_role;

commit;
