import { describe, expect, it } from "vitest";
import { nextCheckInAt, stableNextCheckInAt } from "../checkIn";

describe("trip check-in scheduling", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  it("keeps the current deadline across frequent location heartbeats", () => {
    const current = "2026-10-18T12:15:00.000Z";
    const laterHeartbeat = new Date("2026-10-18T12:01:00.000Z");

    expect(stableNextCheckInAt(current, laterHeartbeat, new Date("2026-10-18T13:00:00.000Z")).toISOString())
      .toBe(current);
  });

  it("moves the deadline earlier when the updated arrival estimate requires it", () => {
    const current = "2026-10-18T12:15:00.000Z";
    const earlierArrival = new Date("2026-10-18T12:08:00.000Z");

    expect(stableNextCheckInAt(current, now, earlierArrival))
      .toEqual(nextCheckInAt(now, earlierArrival));
  });

  it("creates a deadline for older trips without one", () => {
    const expectedArrival = new Date("2026-10-18T12:20:00.000Z");

    expect(stableNextCheckInAt(null, now, expectedArrival))
      .toEqual(nextCheckInAt(now, expectedArrival));
  });
});
