import { describe, expect, it } from "vitest";
import { normalizeKikiId } from "./buddyIds";

describe("Kiki ID normalization", () => {
  it("normalizes copied IDs without changing their identity", () => {
    expect(normalizeKikiId("KIKI-0123456789ABCDEF")).toBe("KIKI-0123456789ABCDEF");
    expect(normalizeKikiId(" kiki_0123456789abcdef ")).toBe("KIKI-0123456789ABCDEF");
    expect(normalizeKikiId("0123456789abcdef")).toBe("KIKI-0123456789ABCDEF");
  });

  it("rejects malformed IDs rather than doing a broad profile search", () => {
    expect(normalizeKikiId(null)).toBeNull();
    expect(normalizeKikiId("KIKI-1234")).toBeNull();
    expect(normalizeKikiId("KIKI-0123456789ABCDEG")).toBeNull();
    expect(normalizeKikiId("KIKI-0123456789ABCDEF@example.com")).toBeNull();
  });
});
