import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../../../supabase/migrations/20261114000100_buddy_community_report_regions.sql", import.meta.url)),
  "utf8",
);

describe("community report map-region migration", () => {
  it("persists validated area boundaries and returns them in nearby reports", () => {
    expect(sql).toContain("add column region jsonb");
    expect(sql).toContain("a.region");
    expect(sql).toContain("p_region jsonb default null");
    expect(sql).toContain("buddy_community_alerts_region_shape");
  });

  it("checks closed polygon rings and coarsens saved coordinates", () => {
    expect(sql).toContain("v_ring->0 <> v_ring->(jsonb_array_length(v_ring) - 1)");
    expect(sql).toContain("round(v_lng::numeric, 3)");
    expect(sql).toContain("round(v_lat::numeric, 3)");
    expect(sql).toContain("v_distinct_vertices < 3");
  });

  it("keeps report listing and creation restricted to authenticated accounts", () => {
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("to authenticated");
  });
});
