import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../../../supabase/migrations/20261111000000_buddy_community_alert_persistence.sql", import.meta.url)),
  "utf8",
);

describe("community alert persistence migration", () => {
  it("removes automatic expiry from existing and new reports", () => {
    expect(sql).toContain("alter column expires_at drop not null");
    expect(sql).toContain("alter column expires_at drop default");
    expect(sql).toContain("set expires_at = null");
    expect(sql).not.toContain("expires_at > now()");
  });

  it("keeps active reports in the nearby, map, and admin feeds regardless of age", () => {
    for (const functionName of [
      "list_community_alerts(",
      "list_community_alerts_near(",
      "admin_list_buddy_places(",
    ]) {
      const body = sql.split(`function public.${functionName}`)[1]?.split("create or replace function")[0];
      expect(body).toBeDefined();
      expect(body).toContain("resolved_at is null");
      expect(body).not.toContain("expires_at > now()");
    }
  });

  it("allows only the authenticated author to delete a report and grants the RPC to authenticated users", () => {
    expect(sql).toContain("where id = p_alert_id and reporter_id = v_user");
    expect(sql).toContain("delete from public.community_intel_records");
    expect(sql).toContain("public.delete_my_community_alert(uuid) to authenticated");
    expect(sql).toContain("public.delete_my_community_alert(uuid) from public, anon");
  });
});
