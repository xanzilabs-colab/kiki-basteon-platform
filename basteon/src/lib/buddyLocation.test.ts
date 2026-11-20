import { describe, expect, it } from "vitest";
import { isFreshBuddyLocation, isInsidePrivacyZone } from "./buddyLocation";

describe("buddy live location privacy", () => {
  it("only accepts recent timestamps and tolerates small clock skew", () => {
    const now = Date.parse("2026-11-20T08:00:00.000Z");
    expect(isFreshBuddyLocation("2026-11-20T07:59:30.000Z", now)).toBe(true);
    expect(isFreshBuddyLocation("2026-11-20T07:58:29.000Z", now)).toBe(false);
    expect(isFreshBuddyLocation("2026-11-20T08:00:10.000Z", now)).toBe(true);
    expect(isFreshBuddyLocation("2026-11-20T08:01:00.000Z", now)).toBe(false);
    expect(isFreshBuddyLocation("invalid", now)).toBe(false);
  });

  it("suppresses locations inside the owner's privacy zones", () => {
    const zone = { lat: -26.2041, lng: 28.0473, radius_m: 300 };
    expect(isInsidePrivacyZone({ lat: -26.2041, lng: 28.0473 }, [zone])).toBe(true);
    expect(isInsidePrivacyZone({ lat: -26.21, lng: 28.0473 }, [zone])).toBe(false);
    expect(isInsidePrivacyZone({ lat: -26.2041, lng: 28.0473 }, [])).toBe(false);
  });
});
