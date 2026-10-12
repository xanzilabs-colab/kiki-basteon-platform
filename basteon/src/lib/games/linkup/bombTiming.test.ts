import { describe, expect, it } from "vitest";
import { bombFuseRemainingMs } from "./bombTiming";

describe("Hot Potato fuse clock", () => {
  const startedAt = "2026-10-12T17:00:00.000Z";
  const startedMs = Date.parse(startedAt);

  it("ticks from the turn start without waiting for another server poll", () => {
    expect(bombFuseRemainingMs(30_000, "e", startedAt, startedMs + 12_345)).toBe(17_655);
  });

  it("pauses while the passer is choosing the end letter", () => {
    expect(bombFuseRemainingMs(30_000, null, startedAt, startedMs + 12_345)).toBe(30_000);
  });

  it("never displays a negative fuse", () => {
    expect(bombFuseRemainingMs(2_000, "e", startedAt, startedMs + 5_000)).toBe(0);
  });
});
