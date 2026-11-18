import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const locationSql = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261111000300_responder_location_freshness.sql", import.meta.url)),
  "utf8",
);
const resolveSql = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261111000400_responder_can_resolve_attended_alert.sql", import.meta.url)),
  "utf8",
);
const syncAndLogoSql = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261112000000_responder_sync_and_org_logos.sql", import.meta.url)),
  "utf8",
);
const brandingSql = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261118000000_organisation_branding.sql", import.meta.url)),
  "utf8",
);

describe("responder migrations", () => {
  it("keeps GPS freshness separate from on-duty heartbeats", () => {
    expect(locationSql).toContain("add column if not exists last_location_at");
    expect(locationSql).toContain("set last_location_at = last_seen_at");
    expect(locationSql).toContain("before insert or update on public.responder_presence");
    expect(locationSql).toContain("new.last_location_at := now()");
  });

  it("only allows an active, on-scene responder to resolve an incident", () => {
    expect(resolveSql).toContain("aa.status = 'on_scene'");
    expect(resolveSql).toContain("m.status = 'active'");
    expect(resolveSql).toContain("m.role in ('responder', 'dispatcher')");
    expect(resolveSql).toContain("update public.alerts set status = 'resolved'");
    expect(resolveSql).toContain("to service_role");
  });

  it("publishes canonical responder availability and configures public organisation logos", () => {
    expect(syncAndLogoSql).toContain("tablename = 'responder_presence'");
    expect(syncAndLogoSql).toContain("alter publication supabase_realtime add table public.responder_presence");
    expect(syncAndLogoSql).toContain("values ('organisation-logos', 'organisation-logos', true");
  });

  it("scopes organisation branding read and update policies to active memberships and admins", () => {
    expect(brandingSql).toContain("add column if not exists brand_primary_color text");
    expect(brandingSql).toContain("add column if not exists brand_accent_color text");
    expect(brandingSql).toContain("brand_primary_color is null or brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'");
    expect(brandingSql).toContain("brand_accent_color is null or brand_accent_color ~ '^#[0-9A-Fa-f]{6}$'");
    expect(brandingSql).toContain("for select to authenticated");
    expect(brandingSql).toContain("membership.user_id = auth.uid()");
    expect(brandingSql).toContain("membership.status = 'active'");
    expect(brandingSql).toContain("membership.role in ('owner', 'admin')");
    expect(brandingSql).toContain("grant update (brand_primary_color, brand_accent_color)");
  });
});
