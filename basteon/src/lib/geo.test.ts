import { describe, expect, it } from "vitest";
import { isFreshPosition, LOCATION_FIX_MAX_AGE_MS } from "./geo";

describe("responder location freshness", () => {
  const now = 1_800_000_000_000;

  it("accepts a recent GPS fix", () => {
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - 5_000 }, now)).toBe(true);
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - LOCATION_FIX_MAX_AGE_MS }, now)).toBe(true);
  });

  it("rejects stale, future-dated, and untimestamped coordinates", () => {
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - LOCATION_FIX_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now + 1 }, now)).toBe(false);
    expect(isFreshPosition({ lat: -26.2, lng: 28 }, now)).toBe(false);
    expect(isFreshPosition(null, now)).toBe(false);
  });
});
