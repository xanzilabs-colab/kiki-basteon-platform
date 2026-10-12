import { describe, expect, it } from "vitest";
import { adminActionSchema, alertSchema, feedbackSchema, lookForSchema, placeSchema, spotActionSchema } from "../schemas";

describe("meeting input validation", () => {
  it("accepts an address-only spot suggestion and rejects client-supplied coordinates", () => {
    expect(placeSchema.safeParse({ name: "Cafe", category: "cafe_restaurant", address: "12 Main Road, Johannesburg" }).success).toBe(true);
    for (const fields of [{ category: "private_home" }, { name: "x".repeat(201) }, { userId: "spoof" }, { lat: -26, lng: 28 }]) {
      expect(placeSchema.safeParse({ name: "Cafe", category: "cafe_restaurant", address: "12 Main Road, Johannesburg", ...fields }).success).toBe(false);
    }
  });
  it("requires current-round identities for votes and feedback", () => {
    expect(spotActionSchema.safeParse({ action: "vote", round: 0, candidateId: "bad" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ round: 1, candidateId: "00000000-0000-4000-8000-000000000001", reason: "unsafe" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ round: 1, candidateId: "00000000-0000-4000-8000-000000000001", reason: "free text" }).success).toBe(false);
  });
  it("allows removal of look-for details but rejects arbitrary text", () => {
    expect(lookForSchema.safeParse({ topColor: null, carryingBag: null }).success).toBe(true);
    expect(lookForSchema.safeParse({ topColor: "address", carryingBag: true }).success).toBe(false);
  });
  it("requires an address for community alerts and rejects client-supplied coordinates", () => {
    expect(alertSchema.safeParse({ kind: "harassment", address: "12 Main Road, Johannesburg", detail: "Street harassment" }).success).toBe(true);
    expect(alertSchema.safeParse({ kind: "harassment", lat: -26, lng: 28, locationLabel: "somewhere", detail: "Street harassment" }).success).toBe(false);
    expect(alertSchema.safeParse({ kind: "harassment", address: "12 Main Road, Johannesburg", detail: "Street harassment", reporterId: "other" }).success).toBe(false);
    expect(adminActionSchema.safeParse({ action: "review", id: "bad", quality: 6, status: "approved", active: true, open24h: true }).success).toBe(false);
  });
});