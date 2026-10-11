import { describe, expect, it } from "vitest";
import { LINKUP_WORDS } from "./words";

describe("Linkup dictionary", () => {
  it("contains common answers beyond the original starter list", () => {
    expect(LINKUP_WORDS.has("elephant")).toBe(true);
    expect(LINKUP_WORDS.has("computer")).toBe(true);
    expect(LINKUP_WORDS.size).toBeGreaterThan(10_000);
  });

  it("filters non-word input and unsupported characters", () => {
    expect(LINKUP_WORDS.has("notaword")).toBe(false);
    expect([...LINKUP_WORDS].every((word) => /^[a-z]{3,15}$/.test(word))).toBe(true);
  });
});
