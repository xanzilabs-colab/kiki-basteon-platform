import { describe, expect, it } from "vitest";
import { evaluateCommunityText, evaluateInteractiveCommunityText } from "./guardrails";

describe("community Kiki Guard", () => {
  it("allows general safety guidance and public emergency numbers", () => {
    const result = evaluateCommunityText("If you need urgent help in South Africa, call 112 and move to a staffed public place.");

    expect(result.decision).toBe("allow");
    expect(result.intent).toBe("safety_guidance");
    expect(result.safeText).toContain("112");
  });

  it("does not mistake an ISO date for contact information", () => {
    const result = evaluateCommunityText("This safety guide was published on 2026-11-15 for the community to read.");

    expect(result.decision).toBe("allow");
    expect(result.safeText).toContain("2026-11-15");
  });

  it("redacts a personal phone number while keeping useful advice", () => {
    const result = evaluateCommunityText("For support while planning a safer walk, call me at +27 82 123 4567 and I can share general tips.");

    expect(result.decision).toBe("redact");
    expect(result.categories).toContain("contact");
    expect(result.safeText).not.toContain("+27 82 123 4567");
    expect(result.safeText).toContain("[private detail removed]");
  });

  it("refuses a message made only of private contact information", () => {
    const result = evaluateCommunityText("082 123 4567");

    expect(result.decision).toBe("refuse");
    expect(result.categories).toContain("contact");
    expect(result.safeText).not.toContain("082 123 4567");
  });

  it("refuses a message when personal location details leave no safe, coherent remainder", () => {
    const result = evaluateCommunityText("I live at 14 Main Road, Cape Town. My phone number is 082 123 4567.");

    expect(result.decision).toBe("refuse");
    expect(result.intent).toBe("personal_disclosure");
    expect(result.safeText).not.toContain("14 Main Road");
    expect(result.safeText).not.toContain("082 123 4567");
  });

  it("redacts self-identifying names and social handles", () => {
    const result = evaluateCommunityText("My name is Tumi and my Instagram is @tumi_personal. I want to discuss general safety tips.");

    expect(result.decision).toBe("redact");
    expect(result.categories).toContain("identity");
    expect(result.categories).toContain("social");
    expect(result.safeText).not.toContain("Tumi");
    expect(result.safeText).not.toContain("@tumi_personal");
  });

  it("recognizes a third-party disclosure without echoing the private detail", () => {
    const result = evaluateCommunityText("My friend's phone number is 082 123 4567. Share general safety ideas instead.");

    expect(result.intent).toBe("third_party_disclosure");
    expect(result.categories).toContain("contact");
    expect(result.safeText).not.toContain("082 123 4567");
  });

  it("uses safe placeholders and cloaks the signed-in member's real name", () => {
    const result = evaluateInteractiveCommunityText(
      "Tumisho Aphane recommends sharing a general plan. Contact tumisho@example.com.",
      "Tumisho Aphane",
    );

    expect(result.decision).toBe("redact");
    expect(result.safeText).not.toMatch(/Tumisho|Aphane|tumisho@example\.com/i);
    expect(result.safeText).toContain("[community member]");
    expect(result.safeText).toContain("[redacted email]");
    expect(result.removed).toContain("Real name cloaked");
    expect(result.removed).toContain("Email address redacted");
  });

  it("refuses a short field after redaction and preserves emergency numbers and ordinary text", () => {
    const refused = evaluateInteractiveCommunityText("Email me at person@example.com");
    const safe = evaluateInteractiveCommunityText("Call 112 if you need urgent help.");

    expect(refused.decision).toBe("refuse");
    expect(safe.decision).toBe("allow");
    expect(safe.safeText).toContain("112");
  });
});
