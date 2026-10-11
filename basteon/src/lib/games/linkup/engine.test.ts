import { describe, expect, it } from "vitest";
import {
  BOMB,
  bombInit,
  bombResolve,
  bombSetEnd,
  buildIndex,
  buildSpec,
  applyRound,
  chainCarry,
  matchWinner,
  mulberry32,
  normalizeWord,
  rolesForRound,
  scoreRound,
  solutions,
  validateAnswer,
  validateBest,
  wildcardBanner,
} from "./engine";
import type { RoundSpec } from "./engine";
import { botAnswer } from "./bot";

const WORDS = [
  "smart", "shout", "sprout", "start", "sunset", "seat", "salt", "sight", "sit", "set",
  "bird", "bard", "bold", "bead", "bind", "band", "bad", "bid", "brand", "blind",
  "tent", "test", "text", "tart", "tilt", "toast", "trust", "twist", "treat", "tight",
  "cat", "cart", "clot", "coat", "count", "cost", "cut", "chat", "chart", "court",
];
const dict = new Set(WORDS);
const idx = buildIndex(WORDS);
const spec = (overrides: Partial<RoundSpec> = {}): RoundSpec => ({
  round: 1,
  mode: "classic",
  start: "s",
  end: "t",
  mines: [],
  banned: [],
  minLength: 3,
  modifier: "none",
  pointsMultiplier: 1,
  rerolled: false,
  ...overrides,
});

describe("mode rules", () => {
  it("normalizes accents, punctuation, casing, and later words", () => {
    expect(normalizeWord("  Smárt! now ")).toBe("smart");
    expect(normalizeWord("")).toBe("");
  });

  it("rejects a word containing a mine letter", () => {
    expect(validateAnswer("smart", spec({ mode: "minefield", mines: ["m"] }), dict, new Set()).reason).toBe("mine");
  });

  it("tries voice alternatives until one validates", () => {
    expect(validateBest(["smar", "smart"], spec(), dict, new Set()).word).toBe("smart");
  });

  it("describes every wildcard modifier for the answer-phase banner", () => {
    expect(wildcardBanner(spec({ modifier: "long_word" }))).toBe("2x - 7+ letters");
    expect(wildcardBanner(spec({ modifier: "vowel_ban", banned: ["a", "o"] }))).toBe("No A or O");
    expect(wildcardBanner(spec({ modifier: "steal" }))).toBe("Steal: answer in under 1s");
    expect(wildcardBanner(spec())).toBeNull();
  });

  it("returns no chain carry when a chain breaks", () => {
    expect(chainCarry([{ word: "", valid: false, answerMs: null }])).toBeNull();
  });
});

describe("hot potato", () => {
  const good = { valid: true, word: "smart", reason: "ok" as const };
  const bad = { valid: false, word: "x", reason: "wrong_start" as const };

  it("passes the bomb on a correct word and carries its last letter", () => {
    const result = bombResolve(bombSetEnd(bombInit("a", "b", "s"), "t"), good, 2000);
    expect(result.event).toBe("passed");
    expect(result.state.holder).toBe("b");
    expect(result.state.start).toBe("t");
    expect(result.state.end).toBeNull();
    expect(result.state.fuseLeftMs).toBe(BOMB.fuseMs - 2000 + BOMB.correctBonusMs);
  });

  it("penalizes a wrong answer and retries the same holder and letters", () => {
    const initial = bombSetEnd(bombInit("a", "b", "s"), "t");
    const result = bombResolve(initial, bad, 1000);
    expect(result.event).toBe("retry");
    expect(result.state.holder).toBe("a");
    expect(result.state.start).toBe("s");
    expect(result.state.end).toBe("t");
    expect(result.state.fuseLeftMs).toBe(BOMB.fuseMs - 1000 - BOMB.wrongPenaltyMs);
  });

  it("explodes on the holder at zero and remains exploded", () => {
    const initial = bombSetEnd(bombInit("a", "b", "s"), "t");
    const result = bombResolve(initial, good, BOMB.fuseMs + 1);
    expect(result.event).toBe("exploded");
    expect(result.state.loser).toBe("a");
    expect(result.state.fuseLeftMs).toBe(0);
    expect(bombResolve(result.state, good, 0).event).toBe("exploded");
  });

  it("caps the fuse after a correct answer", () => {
    const initial = { ...bombSetEnd(bombInit("a", "b", "s"), "t"), fuseLeftMs: BOMB.maxFuseMs - 500 };
    expect(bombResolve(initial, good, 0).state.fuseLeftMs).toBe(BOMB.maxFuseMs);
  });

  it("never lets the fuse go negative on a penalty", () => {
    const initial = { ...bombSetEnd(bombInit("a", "b", "s"), "t"), fuseLeftMs: 1000 };
    expect(bombResolve(initial, bad, 0).state.fuseLeftMs).toBe(0);
  });
});

describe("round setup helpers", () => {
  it("builds a minefield with exactly two non-endpoint mine letters", () => {
    const result = buildSpec({ round: 1, mode: "minefield", start: "b", end: "d", idx, used: new Set(), rng: mulberry32(3) });
    expect(result.mines).toHaveLength(2);
    expect(result.mines).not.toContain(result.start);
    expect(result.mines).not.toContain(result.end);
    expect(validateAnswer("smart", spec({ mode: "minefield", mines: ["m"] }), dict, new Set()).reason).toBe("mine");
  });

  it("rerolls an unsolvable pair to a solvable pair", () => {
    const result = buildSpec({ round: 1, mode: "classic", start: "q", end: "x", idx, used: new Set(), rng: mulberry32(2) });
    expect(result.rerolled).toBe(true);
    expect(solutions(idx, result, new Set(), 1).length).toBeGreaterThan(0);
  });

  it("retries end letters before changing the start letter", () => {
    const result = buildSpec({ round: 1, mode: "classic", start: "s", end: "x", idx, used: new Set(), rng: mulberry32(10) });
    expect(result.rerolled).toBe(true);
    expect(result.start).toBe("s");
  });

  it("keeps a player's chosen start while finding a playable end", () => {
    const result = buildSpec({
      round: 1,
      mode: "classic",
      start: "s",
      end: "x",
      preserveStart: true,
      idx,
      used: new Set(),
      rng: mulberry32(10),
    });
    expect(result.start).toBe("s");
    expect(solutions(idx, result, new Set(), 1).length).toBeGreaterThan(0);
  });

  it("keeps a player's chosen end while finding a playable start", () => {
    const result = buildSpec({
      round: 1,
      mode: "classic",
      start: "q",
      end: "t",
      preserveEnd: true,
      idx,
      used: new Set(),
      rng: mulberry32(10),
    });
    expect(result.end).toBe("t");
    expect(solutions(idx, result, new Set(), 1).length).toBeGreaterThan(0);
  });

  it("picks an end-letter alternative before rerolling the start", () => {
    const result = buildSpec({ round: 1, mode: "classic", start: "s", end: "x", idx, used: new Set(), rng: mulberry32(10) });
    expect(result.rerolled).toBe(true);
    expect(result.start).toBe("s");
  });

  it("selects the fastest valid answer's last letter as the chain carry", () => {
    expect(chainCarry([
      { word: "smart", valid: true, answerMs: 2000 },
      { word: "sit", valid: true, answerMs: 900 },
    ])).toBe("t");
  });

  it("signals a broken chain when neither answer is valid", () => {
    expect(chainCarry([{ word: "", valid: false, answerMs: null }])).toBeNull();
  });

  it("alternates picker roles by round", () => {
    expect(rolesForRound(1, "p1", "p2").startPicker).toBe("p1");
    expect(rolesForRound(2, "p1", "p2").startPicker).toBe("p2");
  });

  it("uses a tie for the sudden-death signal", () => {
    expect(matchWinner({ a: 10, b: 10 })).toBeNull();
    expect(matchWinner({ a: 12, b: 10 })).toBe("a");
  });

  describe("round scoring", () => {
    const valid = (word: string) => ({ valid: true, word, reason: "ok" as const });

    it("awards the speed bonus to the fastest valid word", () => {
      const results = scoreRound(spec(), [
        { userId: "a", verdict: valid("smart"), answerMs: 1200, streakBefore: 0 },
        { userId: "b", verdict: valid("start"), answerMs: 2500, streakBefore: 0 },
      ]);
      expect(results.map((result) => result.points)).toEqual([150, 100]);
    });

    it("scores no speed bonus for an exact tie and resets a missed streak", () => {
      const tie = scoreRound(spec(), [
        { userId: "a", verdict: valid("smart"), answerMs: 1000, streakBefore: 0 },
        { userId: "b", verdict: valid("start"), answerMs: 1000, streakBefore: 0 },
      ]);
      expect(tie[0].points).toBe(100);
      const missed = scoreRound(spec(), [
        { userId: "a", verdict: { valid: false, word: "x", reason: "wrong_start" }, answerMs: 900, streakBefore: 4 },
        { userId: "b", verdict: valid("smart"), answerMs: 2000, streakBefore: 2 },
      ]);
      expect(missed[0].streakAfter).toBe(0);
      expect(missed[1].points).toBe(Math.round(150 * 1.25));
    });

    it("applies wildcard steals without taking a victim below zero", () => {
      const results = scoreRound(spec({ modifier: "steal" }), [
        { userId: "a", verdict: valid("smart"), answerMs: 600, streakBefore: 0 },
        { userId: "b", verdict: { valid: false, word: "", reason: "timeout" }, answerMs: null, streakBefore: 0 },
      ]);
      const scores = applyRound({ a: 0, b: 20 }, results);
      expect(scores.b).toBe(0);
      expect(scores.a).toBe(results[0].points + 50);
    });
  });
});

describe("Kiki bot", () => {
  it("returns valid words when its answer kind is correct", () => {
    const rng = mulberry32(42);
    let correct = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const answer = botAnswer(idx, spec(), new Set(), "hard", rng);
      if (answer.kind === "correct") {
        correct++;
        expect(validateAnswer(answer.word, spec(), dict, new Set()).valid).toBe(true);
      }
    }
    expect(correct).toBeGreaterThan(150);
  });

  it("answers faster on hard than easy on average", () => {
    const averageDelay = (difficulty: "easy" | "hard") => {
      const rng = mulberry32(7);
      let total = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        total += botAnswer(idx, spec(), new Set(), difficulty, rng).delayMs;
      }
      return total / 100;
    };
    expect(averageDelay("hard")).toBeLessThan(averageDelay("easy"));
  });
});
