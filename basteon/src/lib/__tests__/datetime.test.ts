import { describe, expect, it } from "vitest";
import { fmtRelativeTime } from "../datetime";

describe("relative time formatting", () => {
  it("uses the synchronized server time instead of the device clock", () => {
    const alertTime = "2026-10-26T00:43:00.000Z";
    const serverNow = new Date("2026-10-26T00:44:00.000Z");

    expect(fmtRelativeTime(alertTime, serverNow)).toBe("1 minute ago");
  });

  it("formats future timestamps relative to the authoritative reference time", () => {
    const notificationTime = "2026-10-26T00:45:00.000Z";
    const serverNow = new Date("2026-10-26T00:44:00.000Z");

    expect(fmtRelativeTime(notificationTime, serverNow)).toBe("in 1 minute");
  });
});
