import { describe, expect, it } from "vitest";
import { answerPhaseIndex, effectivePhases, hapticPattern, PATTERNS, pickTrivia, questionPhaseIndex, tickAt } from "../breath/engine";
import { applyChange, buildQuestions, CHANGE_OPTIONS, changeAnswer, generateScene, LEVELS, mulberry32, nextLevel, sessionSummary, TEMPLATES } from "../baseline/engine";
import { activeZones, cycleIntensity, suggestBreathing, summarize, tipsFor, ZONES, type ZoneMap } from "../body/zones";

describe("Gentle Winds engine", () => {
  it("tracks phase boundaries and completion from elapsed time", () => {
    const phases = [{ kind: "inhale" as const, ms: 1000, from: 0.35, to: 1 }, { kind: "exhale" as const, ms: 1000, from: 1, to: 0.35 }];
    expect(tickAt(phases, 1, 0).size).toBe(0.35);
    expect(tickAt(phases, 1, 500).kind).toBe("inhale");
    expect(tickAt(phases, 1, 1000).phaseIndex).toBe(1);
    expect(tickAt(phases, 1, 2000).done).toBe(true);
    for (let ms = 0; ms < 2000; ms += 25) {
      expect(tickAt(phases, 1, ms).size).toBeGreaterThanOrEqual(0.35);
      expect(tickAt(phases, 1, ms).size).toBeLessThanOrEqual(1);
    }
  });
  it("filters optional holds, applies pace and places trivia within breath phases", () => {
    expect(effectivePhases(PATTERNS.box, false, "standard").map((phase) => phase.kind)).not.toContain("hold");
    expect(effectivePhases(PATTERNS.slow, true, "gentle")[0].ms).toBe(5000);
    expect(questionPhaseIndex(PATTERNS.box.phases)).toBe(1);
    expect(answerPhaseIndex(PATTERNS.box.phases)).toBe(2);
    expect(questionPhaseIndex(PATTERNS.sigh.phases)).toBe(1);
    expect(answerPhaseIndex(PATTERNS.sigh.phases)).toBe(2);
    expect(answerPhaseIndex(PATTERNS.slow.phases)).toBe(1);
  });
  it("creates gradual phase haptics and prefers unseen trivia", () => {
    const inhale = hapticPattern("inhale", 2000).filter((_, index) => index % 2 === 0);
    const exhale = hapticPattern("exhale", 2000).filter((_, index) => index % 2 === 0);
    expect(inhale.at(-1)).toBeGreaterThan(inhale[0]);
    expect(exhale.at(-1)).toBeLessThan(exhale[0]);
    expect(hapticPattern("hold", 4000)).toEqual([]);
    expect(hapticPattern("topup", 1200)).toEqual([35, 70, 35]);
    const selected = pickTrivia([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["a"]), 2, mulberry32(7));
    expect(selected.map((item) => item.id)).not.toContain("a");
  });
});

describe("Spot the Baseline engine", () => {
  it("is deterministic, places people apart and uses each level's requested count", () => {
    for (const level of [1, 2, 3] as const) {
      const scene = generateScene(42, level);
      expect(generateScene(42, level)).toEqual(scene);
      expect(scene.people).toHaveLength(LEVELS[level].people);
      for (let i = 0; i < scene.people.length; i++) for (let j = i + 1; j < scene.people.length; j++) {
        expect(Math.hypot(scene.people[i].x - scene.people[j].x, scene.people[i].y - scene.people[j].y)).toBeGreaterThanOrEqual(16);
      }
      const questions = buildQuestions(scene, level, mulberry32(9));
      for (const question of questions) {
        const selected = question.options[question.answer];
        if (question.id === "exits") expect(selected).toBe(String(scene.exits.length));
        if (question.id === "bags") expect(selected).toBe(String(scene.people.filter((person) => person.item === "bag").length));
        if (question.id === "sit") expect(selected).toBe(scene.people.some((person) => person.zone === "window" && person.pose === "sitting") ? "Yes" : "No");
        if (question.id === "colour") {
          const exit = scene.exits[0];
          const closest = [...scene.people].sort((a, b) => Math.hypot(a.x - exit.x, a.y - exit.y) - Math.hypot(b.x - exit.x, b.y - exit.y))[0];
          expect(selected).toBe(closest.color);
        }
      }
    }
  });
  it("omits an ambiguous colour prompt and makes every change observable", () => {
    const scene = generateScene(12, 2);
    const template = TEMPLATES.find((value) => value.id === scene.template)!;
    const ambiguous = {
      ...scene,
      people: scene.people.map((person, index) => index < 2
        ? { ...person, x: index === 0 ? template.exits[0].x - 4 : template.exits[0].x + 4, y: template.exits[0].y - 8 }
        : person),
    };
    expect(buildQuestions(ambiguous, 2, mulberry32(3)).some((question) => question.id === "colour")).toBe(false);
    for (let seed = 0; seed < 20; seed++) {
      const change = applyChange(scene, mulberry32(seed));
      expect(change.scene.people).not.toEqual(scene.people);
      expect(CHANGE_OPTIONS[changeAnswer(change.kind)]).toBeTruthy();
    }
    expect(changeAnswer("left")).toBe(0);
    expect(changeAnswer("colour")).toBe(1);
    expect(changeAnswer("item")).toBe(2);
  });
  it("advances gently only after two good sessions and never falls", () => {
    expect(sessionSummary([true, false, true])).toEqual({ correct: 2, total: 3, pct: 67 });
    expect(nextLevel(1, [80, 75])).toBe(2);
    expect(nextLevel(2, [100, 74])).toBe(2);
    expect(nextLevel(3, [100, 100])).toBe(3);
  });
});

describe("Body Check engine", () => {
  it("cycles intensity, sorts at most three tips and only suggests breathing for multiple strong areas", () => {
    expect(cycleIntensity(3)).toBe(0);
    expect(cycleIntensity(undefined)).toBe(1);
    const map: ZoneMap = { jaw: 1, neck: 3, chest: 2, hands: 3 };
    expect(activeZones(map)[0][0]).toBe("neck");
    expect(tipsFor(map)).toHaveLength(3);
    expect(suggestBreathing(map)).toBe(true);
    expect(suggestBreathing({ jaw: 3, neck: 2 })).toBe(false);
  });
  it("summarizes empty and saved histories without diagnosing", () => {
    expect(summarize([])).toEqual({ top: [], helpedPct: null, count: 0 });
    expect(ZONES).toHaveLength(9);
    expect(summarize([{ at: "now", zones: { jaw: 3 }, before: 2, after: 4 }]).helpedPct).toBe(100);
  });
});
