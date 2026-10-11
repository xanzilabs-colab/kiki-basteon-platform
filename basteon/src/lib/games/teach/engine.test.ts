import { describe, expect, it } from "vitest";
import { scanText, validateCard, sessionScores, promotionEligible, shuffledOptions } from "./engine";

const card = (o: Partial<Parameters<typeof validateCard>[0]> = {}) => ({
  problem: "Money runs out early.",
  tip: "Set aside needs first on pay day, then a small saving.",
  example: "Pay rent first.",
  checkQ: "What do you set aside first?",
  checkOptions: ["Fun money", "Needs", "Nothing"],
  checkAnswer: 1,
  ...o,
});

describe("scanText", () => {
  it("detects phone, email, link, ID, address and handle", () => {
    expect(scanText("call me on 082 123 4567").pii).toContain("phone number");
    expect(scanText("mail a.b@c.co.za").pii).toContain("email address");
    expect(scanText("see www.example.com").pii).toContain("web link");
    expect(scanText("id 8001015009087").pii).toContain("ID number");
    expect(scanText("I live at 12 Main Street").pii).toContain("street address");
    expect(scanText("find me @sister_aloe").pii).toContain("social handle");
  });

  it("detects risky categories and self-harm", () => {
    expect(scanText("take a higher dose").risk).toContain("medical");
    expect(scanText("you should sue them").risk).toContain("legal");
    expect(scanText("I want to die").selfHarm).toBe(true);
  });

  it("lets harmless text through", () => {
    expect(scanText("Plan your week on Sunday.")).toEqual({ pii: [], risk: [], selfHarm: false });
  });
});

describe("validateCard", () => {
  it("accepts a good card", () => expect(validateCard(card(), { verified: false }).ok).toBe(true));
  it("rejects bad shapes", () => {
    expect(validateCard(card({ tip: "short" }), { verified: false }).ok).toBe(false);
    expect(validateCard(card({ checkOptions: ["a", "a", "b"] }), { verified: false }).ok).toBe(false);
    expect(validateCard(card({ checkAnswer: 3 }), { verified: false }).ok).toBe(false);
  });

  it("blocks personal information", () => {
    const verdict = validateCard(card({ tip: "Call me on 0821234567 for help with budgets." }), { verified: false });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("pii");
  });

  it("blocks professional advice for unverified authors only", () => {
    const tip = card({ tip: "Double your dose if you feel unwell, trust me." });
    const unverified = validateCard(tip, { verified: false });
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) expect(unverified.code).toBe("professional");
    expect(validateCard(tip, { verified: true }).ok).toBe(true);
  });

  it("never allows self-harm text, even from verified authors", () => {
    const verdict = validateCard(card({ tip: "Some days I want to die and that is okay." }), { verified: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("self_harm");
  });
});

describe("scores and promotion", () => {
  it("adds up teacher and learner XP", () => {
    expect(sessionScores({ ratingsOnMyCards: ["helpful", "try"], myQuizResults: [true, false, true], cardsAuthored: 2 }))
      .toEqual({ teacher: 20 + 12 + 20, learner: 30 });
  });

  it("promotes only eligible community cards", () => {
    expect(promotionEligible({ tier: "community", distinctHelpful: 5, openReports: 0, flagged: false })).toBe(true);
    expect(promotionEligible({ tier: "community", distinctHelpful: 4, openReports: 0, flagged: false })).toBe(false);
    expect(promotionEligible({ tier: "community", distinctHelpful: 9, openReports: 1, flagged: false })).toBe(false);
    expect(promotionEligible({ tier: "seed", distinctHelpful: 9, openReports: 0, flagged: false })).toBe(false);
    expect(promotionEligible({ tier: "community", distinctHelpful: 9, openReports: 0, flagged: true })).toBe(false);
  });

  it("shuffles options without losing the answer mapping", () => {
    const result = shuffledOptions(["a", "b", "c"], 1, 42);
    expect(result.options[result.answer]).toBe("b");
    expect([...result.options].sort()).toEqual(["a", "b", "c"]);
  });
});
