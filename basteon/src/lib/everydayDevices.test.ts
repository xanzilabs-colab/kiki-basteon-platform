import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVERYDAY_DEVICE_GUIDES, EVERYDAY_DEVICE_KINDS } from "./everydayDevices";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20261113000100_trigger_everyday_device_types.sql", import.meta.url)),
  "utf8",
);

describe("everyday trigger-device guides", () => {
  it("provides connection, button, practice, and recovery guidance for every supported device category", () => {
    expect(EVERYDAY_DEVICE_KINDS).toHaveLength(10);
    for (const kind of EVERYDAY_DEVICE_KINDS) {
      const guide = EVERYDAY_DEVICE_GUIDES[kind];
      expect(guide.label).toBeTruthy();
      expect(guide.connect).toBeTruthy();
      expect(guide.press).toBeTruthy();
      expect(guide.practice).toBeTruthy();
      expect(guide.reconnect.length).toBeGreaterThan(0);
    }
  });

  it("warns that pairing alone does not establish support for manual accessories", () => {
    expect(EVERYDAY_DEVICE_GUIDES.watch.practice).toContain("Compatibility varies");
    expect(EVERYDAY_DEVICE_GUIDES.pedal.practice).toContain("do not reach");
  });

  it("keeps every client device type allowed by the database constraint", () => {
    for (const kind of EVERYDAY_DEVICE_KINDS) expect(migration).toContain(`'${kind}'`);
  });
});
