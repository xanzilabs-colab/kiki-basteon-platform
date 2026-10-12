import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261111000500_read_room_advance_all_scenarios.sql", import.meta.url)),
  "utf8",
);

describe("Read the Room round advancement migration", () => {
  it("accepts every scenario and makes repeated readiness requests safe", () => {
    expect(migration).toContain("p_next_scenario_id not between 0 and 11");
    expect(migration).toContain("'already_advanced', true");
    expect(migration).toContain("v_session.status = 'finished'");
    expect(migration).toContain("grant execute on function public.read_room_advance");
  });
});
