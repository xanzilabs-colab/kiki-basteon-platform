import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261111000200_linkup_atomic_bomb_turn.sql", import.meta.url)),
  "utf8",
);

describe("Linkup bot answer and bomb turn migration", () => {
  it("allows bot answers without an auth user while retaining their actor id", () => {
    expect(sql).toContain("alter column user_id drop not null");
  });

  it("commits each bomb state transition and its history row in one locked transaction", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("v_match.turn_no <> p_expected_turn");
    expect(sql).toContain("insert into public.linkup_turns");
    expect(sql).toContain("grant execute");
    expect(sql).toContain("to service_role");
  });
});
