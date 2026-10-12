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
});
