import { describe, expect, it } from "vitest";
import { adminActionSchema, alertSchema, feedbackSchema, lookForSchema, placeSchema, spotActionSchema } from "../schemas";

describe("meeting input validation", () => {
  it("rejects invalid coordinates, categories and oversized names", () => {
    expect(placeSchema.safeParse({ name: "Cafe", category: "cafe_restaurant", lat: -26, lng: 28 }).success).toBe(true);
    for (const fields of [{ lat: 91 }, { lng: Infinity }, { category: "private_home" }, { name: "x".repeat(201) }, { userId: "spoof" }]) {
      expect(placeSchema.safeParse({ name: "Cafe", category: "cafe_restaurant", lat: -26, lng: 28, ...fields }).success).toBe(false);
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
  it("restricts community alerts and admin review inputs", () => {
    expect(alertSchema.safeParse({ kind: "harassment", lat: -26, lng: 28 }).success).toBe(true);
    expect(alertSchema.safeParse({ kind: "harassment", lat: -26, lng: 28, reporterId: "other" }).success).toBe(false);
    expect(adminActionSchema.safeParse({ action: "review", id: "bad", quality: 6, status: "approved", active: true, open24h: true }).success).toBe(false);
  });
});