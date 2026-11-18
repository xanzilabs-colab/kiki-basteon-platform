import { describe, expect, it } from "vitest";
import { BRAND_HEX_PATTERN, contrastRatio, resolveBrandColors } from "./organisationBranding";

describe("organisation branding colors", () => {
  it("accepts only six-digit hex colors", () => {
    expect(BRAND_HEX_PATTERN.test("#aB12Ef")).toBe(true);
    expect(BRAND_HEX_PATTERN.test("#abc")).toBe(false);
    expect(BRAND_HEX_PATTERN.test("red")).toBe(false);
  });

  it("lightens low-contrast primary colors for the dark dashboard", () => {
    const colors = resolveBrandColors("#111111", null);
    expect(colors.primaryAdjusted).toBe(true);
    expect(contrastRatio(colors.primary, "#08090A")).toBeGreaterThanOrEqual(3);
  });

  it("derives an accessible primary text color and flags emergency-red hues", () => {
    const colors = resolveBrandColors("#D8202F", "#345678");
    expect(colors.primaryNearEmergencyRed).toBe(true);
    expect(Math.max(contrastRatio(colors.primary, "#000000"), contrastRatio(colors.primary, "#FFFFFF"))).toBeGreaterThanOrEqual(4.5);
    expect(colors.accent).toBe("#345678");
  });
});
