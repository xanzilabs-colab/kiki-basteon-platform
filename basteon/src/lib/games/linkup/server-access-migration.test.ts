import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261111000100_linkup_server_round_access.sql", import.meta.url)),
  "utf8",
);

describe("Linkup server-side round access migration", () => {
  it("grants only the server role access needed for round and answer operations", () => {
    expect(sql).toContain("grant select, insert, update");
    expect(sql).toContain("public.linkup_rounds, public.linkup_answers");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("to authenticated");
    expect(sql).not.toContain("to anon");
  });
});
