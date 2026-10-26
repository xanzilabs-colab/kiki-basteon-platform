import { describe, expect, it } from "vitest";
import { hasUsableLocationAccuracy, isFreshPosition, LOCATION_FIX_MAX_AGE_MS, MAX_LOCATION_ACCURACY_M } from "./geo";

describe("responder location freshness", () => {
  const now = 1_800_000_000_000;

  it("accepts a recent GPS fix", () => {
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - 5_000 }, now)).toBe(true);
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - LOCATION_FIX_MAX_AGE_MS }, now)).toBe(true);
  });

  describe("location accuracy", () => {
    it("accepts a browser or GPS fix within the 150 metre accuracy limit", () => {
      expect(hasUsableLocationAccuracy({ lat: -23.9, lng: 29.4, accuracy: 120 })).toBe(true);
      expect(hasUsableLocationAccuracy({ lat: -23.9, lng: 29.4, accuracy: 150 })).toBe(true);
    });

    it("rejects rough, missing, and non-finite accuracy rather than presenting a guessed city as live GPS", () => {
      expect(MAX_LOCATION_ACCURACY_M).toBe(150);
      expect(hasUsableLocationAccuracy({ lat: -26.2, lng: 28, accuracy: 151 })).toBe(false);
      expect(hasUsableLocationAccuracy({ lat: -26.2, lng: 28, accuracy: 800 })).toBe(false);
      expect(hasUsableLocationAccuracy({ lat: -26.2, lng: 28, accuracy: 3_000 })).toBe(false);
      expect(hasUsableLocationAccuracy({ lat: -26.2, lng: 28 })).toBe(false);
      expect(hasUsableLocationAccuracy({ lat: -26.2, lng: 28, accuracy: Number.NaN })).toBe(false);
    });
  });

  it("rejects stale, future-dated, and untimestamped coordinates", () => {
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now - LOCATION_FIX_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isFreshPosition({ lat: -26.2, lng: 28, capturedAt: now + 1 }, now)).toBe(false);
    expect(isFreshPosition({ lat: -26.2, lng: 28 }, now)).toBe(false);
    expect(isFreshPosition(null, now)).toBe(false);
  });
});
