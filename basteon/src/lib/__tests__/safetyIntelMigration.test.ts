import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261116000000_recurring_safety_intel_acknowledgements.sql", import.meta.url)),
  "utf8",
);

describe("recurring safety intelligence alert migration", () => {
  it("deduplicates concurrent reminder sends per user, report, and five-minute slot", () => {
    expect(sql).toContain("add column if not exists reminder_slot bigint");
    expect(sql).toContain("create unique index if not exists safety_intel_alert_log_reminder_slot_idx");
    expect(sql).toContain("(user_id, record_id, reminder_slot)");
  });

  it("persists per-user report acknowledgements outside the notification read state", () => {
    expect(sql).toContain("create table if not exists public.safety_intel_alert_acknowledgements");
    expect(sql).toContain("primary key (user_id, record_id)");
    expect(sql).toContain("alter table public.safety_intel_alert_acknowledgements enable row level security");
  });
});
