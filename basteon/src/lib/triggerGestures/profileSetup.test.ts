import { describe, expect, it } from "vitest";
import { resolveGestureProfileName } from "./profileSetup";

describe("gesture profile names", () => {
  it("uses a trimmed connected accessory name when the user has not renamed the profile", () => {
    expect(resolveGestureProfileName("", false, "  Studio headset  ")).toBe("Studio headset");
  });

  it("uses a sensible automatic name when the accessory has no display name", () => {
    expect(resolveGestureProfileName("", false, "  ")).toBe("Bluetooth accessory");
  });

  it("preserves a trimmed manual rename and rejects a manually emptied name", () => {
    expect(resolveGestureProfileName("  My setup  ", true, "Headset")).toBe("My setup");
    expect(resolveGestureProfileName("   ", true, "Headset")).toBe("");
  });
});
