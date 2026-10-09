import { describe, expect, it } from "vitest";
import { applyAnswer, needsPerson, newRound, nextMove, parseYesNo, rank, type Move } from "./engine";
import { classify } from "./understand";

function baseRoundFor(sense: "hear" | "smell" | "see" | "feel" | "taste") {
  return { ...newRound(sense), settingAsked: true, postureAsked: true, setting: sense === "smell" ? "bedroom" : "living" };
}

describe("stoep engine regressions", () => {
  it("classifies short yes/no variants correctly", () => {
    expect(classify("Yes").intent).toBe("YES");
    expect(classify("no").intent).toBe("NO");
    expect(classify("Nooe neither").intent).toBe("NO");
    expect(classify("ja").intent).toBe("YES");
    expect(classify("nee").intent).toBe("NO");
  });

  it("does not treat setting words as direct object answers", () => {
    expect(classify("Bedroom").intent).not.toBe("DIRECT_ANSWER");
    const res = applyAnswer(newRound("hear"), { kind: "setting" }, "Bedroom");
    expect(res.reveal).toBeUndefined();
  });

  it("treats yes to a guess as a win signal", () => {
    const round = baseRoundFor("hear");
    const result = applyAnswer(round, { kind: "guess", label: "television" }, "Yes");
    expect(result.yes).toBe(true);
  });

  it("reveals a different object when correcting guess by naming it", () => {
    const round = baseRoundFor("hear");
    const result = applyAnswer(round, { kind: "guess", label: "traffic" }, "It's television");
    expect(result.reveal).toBe("television");
  });

  it("treats challenge text as non-win in guess mode", () => {
    const round = baseRoundFor("smell");
    const result = applyAnswer(round, { kind: "guess", label: "books" }, "How can a book smell fruity?");
    expect(result.yes).toBe(false);
    expect(result.reveal).toBeUndefined();
  });

  it("parses 'Nooe neither' as NO for steady question", () => {
    const round = baseRoundFor("hear");
    const move: Move = { kind: "ask", id: "f:steady", text: "Is it a steady hum, tick or buzz?" };
    const result = applyAnswer(round, move, "Nooe neither");
    expect(result.intent).toBe("NO");
    expect(result.round.facts["f:steady"]).toBe(false);
  });

  it("handles music as CHOICE and confirms it", () => {
    const round = baseRoundFor("hear");
    const move: Move = { kind: "ask", id: "f:speech", text: "Is it voices or music?", options: ["voices", "music"] };
    const result = applyAnswer(round, move, "Music");
    expect(result.intent).toBe("CHOICE");
    expect(result.round.facts["f:speech"]).toBe(false);
    expect(result.reveal).toBe("music");
  });

  it("uses fruity descriptor for bedroom smell candidates and avoids immediate food/fresh question", () => {
    const round = baseRoundFor("smell");
    const move: Move = { kind: "ask", id: "d:fruity", text: "Would you call the smell fruity?" };
    const result = applyAnswer(round, move, "Fruity");
    expect(result.round.descriptors).toContain("fruity");
    const topLabels = rank(result.round).slice(0, 6).map((c) => c.o.label);
    expect(topLabels.some((label) => ["perfume", "body lotion", "body spray", "orange peel"].includes(label))).toBe(true);
    const followup = nextMove(result.round);
    if (followup.kind === "ask") {
      expect(["f:food", "f:fresh"]).not.toContain(followup.id);
    }
  });

  it("treats challenge on wrong guess honestly and rejects the guess", () => {
    const round = baseRoundFor("smell");
    const result = applyAnswer(round, { kind: "guess", label: "book" }, "How can a book smell fruity?");
    expect(result.intent).toBe("CHALLENGE");
    expect(result.yes).toBe(false);
    expect(result.round.rejected).toContain("book");
    expect(result.reply?.toLowerCase()).toContain("scratch that");
  });

  it("reveals direct answer immediately", () => {
    const round = baseRoundFor("hear");
    const result = applyAnswer(round, { kind: "ask", id: "f:steady", text: "Is it steady?" }, "music");
    expect(result.reveal).toBe("music");
  });

  it("treats green as descriptor/color and keeps flow", () => {
    const round = baseRoundFor("see");
    const result = applyAnswer(round, { kind: "ask", id: "f:big", text: "Is it big?" }, "green");
    expect(result.intent).toBe("DESCRIPTOR");
    expect(result.reveal).toBeUndefined();
    expect(result.round.facts["c:green"]).toBe(true);
  });

  it("parses common yes/no/unsure variants", () => {
    expect(parseYesNo("yesss")).toBe("yes");
    expect(parseYesNo("nahhh")).toBe("no");
    expect(parseYesNo("yeah nah")).toBe("no");
    expect(parseYesNo("idk")).toBe("maybe");
    expect(parseYesNo("kinda")).toBe("maybe");
  });

  it("still triggers needsPerson on distress language", () => {
    expect(needsPerson("I want to die")).toBe(true);
  });

  it("fuzz: classify/apply/nextMove never throws on random input", () => {
    const random = (n: number) => Array.from({ length: n }, () => String.fromCharCode(32 + Math.floor(Math.random() * 95))).join("");
    for (let i = 0; i < 10_000; i++) {
      const text = i % 7 === 0 ? "👍" : i % 11 === 0 ? "👎" : random(8 + Math.floor(Math.random() * 48));
      const c = classify(text);
      expect(c.intent).toBeTruthy();
      const round = newRound((["see", "feel", "hear", "smell", "taste"][i % 5]) as "see" | "feel" | "hear" | "smell" | "taste");
      const move = nextMove(round);
      const accepted = move.kind === "setting" || move.kind === "posture" || move.kind === "ask" || move.kind === "guess" || move.kind === "reveal" || move.kind === "stuck";
      expect(accepted).toBe(true);
      if (move.kind !== "stuck") {
        const res = applyAnswer(round, move, text);
        expect(res.round).toBeTruthy();
      }
    }
  }, 300000);
});
