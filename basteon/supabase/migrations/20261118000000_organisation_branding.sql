-- Organisation white-label branding.
-- Rollback: drop the branding policies, revoke the column grants, restore the
-- authenticated table grants used before this migration, drop the two checks,
-- then drop brand_primary_color and brand_accent_color.

alter table public.organisations
  add column if not exists brand_primary_color text,
  add column if not exists brand_accent_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organisations_brand_primary_color_hex'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_brand_primary_color_hex
      check (brand_primary_color is null or brand_primary_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organisations_brand_accent_color_hex'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_brand_accent_color_hex
      check (brand_accent_color is null or brand_accent_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;

drop policy if exists organisations_read_own_branding on public.organisations;
create policy organisations_read_own_branding on public.organisations
for select to authenticated
using (
  exists (
    select 1 from public.organisation_memberships membership
    where membership.organisation_id = organisations.id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  )
);

drop policy if exists organisations_update_own_branding on public.organisations;
create policy organisations_update_own_branding on public.organisations
for update to authenticated
using (
  exists (
    select 1 from public.organisation_memberships membership
    where membership.organisation_id = organisations.id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.organisation_memberships membership
    where membership.organisation_id = organisations.id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  )
);

revoke select, update on table public.organisations from anon, authenticated;
grant select (id, name, display_name, logo_url, brand_primary_color, brand_accent_color)
  on table public.organisations to authenticated;
grant update (brand_primary_color, brand_accent_color)
  on table public.organisations to authenticated;
