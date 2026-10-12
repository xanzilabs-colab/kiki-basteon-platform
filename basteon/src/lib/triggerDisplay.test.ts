import { describe, expect, it } from "vitest";
import { describeTriggerPattern } from "./triggerDisplay";

describe("Bluetooth trigger descriptions", () => {
  it("maps supported alert rhythms to user-facing explanations", () => {
    expect(describeTriggerPattern("3-2")).toContain("Medical rhythm");
    expect(describeTriggerPattern("2-2-2")).toContain("Duress rhythm");
    expect(describeTriggerPattern("4")).toContain("Cancel rhythm");
    expect(describeTriggerPattern("5")).toContain("SOS rhythm");
  });

  it("handles unknown and missing patterns without inventing a supported rhythm", () => {
    expect(describeTriggerPattern("5-2")).toBe("Media-button sequence 5-2");
    expect(describeTriggerPattern(null)).toBeNull();
  });
});
