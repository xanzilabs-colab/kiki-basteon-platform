export const CONFIG = {
  rounds: 10,
  countdownMs: 3000,
  pickMs: 4000,
  revealMs: 1400,
  answerMs: 5000,
  graceMs: 400,
  resultMs: 2400,
  minLength: 3,
  minSolutions: 5,
  baseScore: 100,
  speedBonus: 50,
  lengthBonusPerLetter: 10,
  lengthBonusCap: 50,
  stealAmount: 50,
  stealWithinMs: 1000,
} as const;

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/** Lower-case, strip accents, keep the FIRST word only, keep a-z only. */
export function normalizeWord(raw: string): string {
  const first =
    raw
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .split(/\s+/)[0] ?? "";
  return first.replace(/[^a-z]/g, "");
}

export type WordIndex = Map<string, string[]>;

/** Index words by first+last letter. Only words of length >= minLength, a-z only. */
export function buildIndex(words: Iterable<string>): WordIndex {
  const idx: WordIndex = new Map();
  for (const w of words) {
    if (w.length < CONFIG.minLength || !/^[a-z]+$/.test(w)) continue;
    const k = w[0] + w[w.length - 1];
    const arr = idx.get(k);
    if (arr) arr.push(w);
    else idx.set(k, [w]);
  }
  return idx;
}

export type Mode = "classic" | "minefield" | "chain" | "wildcard" | "bomb";
export type Modifier = "none" | "long_word" | "vowel_ban" | "steal";

export interface RoundSpec {
  round: number;
  mode: Mode;
  start: string;
  end: string;
  mines: string[];
  banned: string[];
  minLength: number;
  modifier: Modifier;
  pointsMultiplier: number;
  rerolled: boolean;
}

export function matches(spec: RoundSpec, w: string): boolean {
  if (w.length < spec.minLength) return false;
  if (w[0] !== spec.start || w[w.length - 1] !== spec.end) return false;
  for (const c of w) {
    if (spec.mines.includes(c) || spec.banned.includes(c)) return false;
  }
  return true;
}

export function solutions(
  idx: WordIndex,
  spec: RoundSpec,
  used: Set<string>,
  cap = Infinity,
): string[] {
  const out: string[] = [];
  for (const w of idx.get(spec.start + spec.end) ?? []) {
    if (used.has(w) || !matches(spec, w)) continue;
    out.push(w);
    if (out.length >= cap) break;
  }
  return out;
}

function pickN<T>(arr: T[], n: number, rng: Rng): T[] {
  const a = [...arr];
  for (let i = 0; i < n && i < a.length; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export interface BuildSpecArgs {
  round: number;
  mode: Mode;
  start: string;
  end: string;
  idx: WordIndex;
  used: Set<string>;
  rng: Rng;
}

/** Turns the two picked letters into a solvable RoundSpec (rerolls unlucky pairs, adds mode rules). */
export function buildSpec(a: BuildSpecArgs): RoundSpec {
  const mk = (s: string, e: string, rerolled: boolean): RoundSpec => ({
    round: a.round,
    mode: a.mode,
    start: s,
    end: e,
    mines: [],
    banned: [],
    minLength: CONFIG.minLength,
    modifier: "none",
    pointsMultiplier: 1,
    rerolled,
  });
  const enough = (s: RoundSpec) =>
    solutions(a.idx, s, a.used, CONFIG.minSolutions).length >= CONFIG.minSolutions;

  let spec = mk(a.start, a.end, false);
  if (!enough(spec)) {
    const ends = LETTERS.filter((l) => enough(mk(a.start, l, true)));
    if (ends.length) {
      spec = mk(a.start, ends[Math.floor(a.rng() * ends.length)], true);
    } else {
      const pairs: [string, string][] = [];
      for (const s of LETTERS) {
        for (const e of LETTERS) if (enough(mk(s, e, true))) pairs.push([s, e]);
      }
      if (pairs.length) {
        const p = pairs[Math.floor(a.rng() * pairs.length)];
        spec = mk(p[0], p[1], true);
      }
    }
  }

  if (a.mode === "minefield") {
    for (let i = 0; i < 30; i++) {
      const pool = LETTERS.filter((l) => l !== spec.start && l !== spec.end);
      const t: RoundSpec = { ...spec, mines: pickN(pool, 2, a.rng) };
      if (enough(t)) return t;
    }
    return spec;
  }

  if (a.mode === "wildcard") {
    const mods: Modifier[] = ["long_word", "vowel_ban", "steal"];
    const m = mods[Math.floor(a.rng() * mods.length)];
    const t: RoundSpec = { ...spec, modifier: m };
    if (m === "long_word") {
      t.minLength = 7;
      t.pointsMultiplier = 2;
    }
    if (m === "vowel_ban") {
      t.banned = ["a", "o"].filter((l) => l !== spec.start && l !== spec.end);
    }
    if (m !== "steal" && !enough(t)) return spec;
    return t;
  }

  return spec;
}

export type Reason =
  | "ok"
  | "empty"
  | "timeout"
  | "too_short"
  | "wrong_start"
  | "wrong_end"
  | "mine"
  | "banned"
  | "repeat"
  | "blocked"
  | "not_a_word";

export interface Verdict {
  valid: boolean;
  word: string;
  reason: Reason;
}

export function validateAnswer(
  raw: string | null,
  spec: RoundSpec,
  dict: Set<string>,
  used: Set<string>,
  blocked: Set<string> = new Set(),
): Verdict {
  const word = raw == null ? "" : normalizeWord(raw);
  if (!word) return { valid: false, word, reason: raw == null ? "timeout" : "empty" };
  if (word.length < spec.minLength) return { valid: false, word, reason: "too_short" };
  if (word[0] !== spec.start) return { valid: false, word, reason: "wrong_start" };
  if (word[word.length - 1] !== spec.end) return { valid: false, word, reason: "wrong_end" };
  for (const c of word) {
    if (spec.mines.includes(c)) return { valid: false, word, reason: "mine" };
    if (spec.banned.includes(c)) return { valid: false, word, reason: "banned" };
  }
  if (used.has(word)) return { valid: false, word, reason: "repeat" };
  if (blocked.has(word)) return { valid: false, word, reason: "blocked" };
  if (!dict.has(word)) return { valid: false, word, reason: "not_a_word" };
  return { valid: true, word, reason: "ok" };
}

/** For voice: try each recognition alternative, accept the first valid one. */
export function validateBest(
  raws: string[] | null,
  spec: RoundSpec,
  dict: Set<string>,
  used: Set<string>,
  blocked: Set<string> = new Set(),
): Verdict {
  if (!raws || raws.length === 0) return { valid: false, word: "", reason: "timeout" };
  let first: Verdict | null = null;
  for (const r of raws) {
    const v = validateAnswer(r, spec, dict, used, blocked);
    if (v.valid) return v;
    if (!first) first = v;
  }
  return first ?? { valid: false, word: "", reason: "timeout" };
}

export interface PlayerRoundInput {
  userId: string;
  verdict: Verdict;
  answerMs: number | null;
  streakBefore: number;
}

export interface PlayerRoundResult {
  userId: string;
  valid: boolean;
  word: string;
  reason: Reason;
  points: number;
  streakAfter: number;
  first: boolean;
  stolen: number;
}

export const streakMultiplier = (s: number): number =>
  s >= 8 ? 2 : s >= 5 ? 1.5 : s >= 3 ? 1.25 : 1;

export function scoreRound(spec: RoundSpec, players: PlayerRoundInput[]): PlayerRoundResult[] {
  const valids = players
    .filter((p) => p.verdict.valid && p.answerMs != null)
    .sort((x, y) => (x.answerMs ?? Infinity) - (y.answerMs ?? Infinity));
  const tie = valids.length === 2 && valids[0].answerMs === valids[1].answerMs;
  const fastestId = !tie && valids.length ? valids[0].userId : null;

  return players.map((p) => {
    if (!p.verdict.valid) {
      return {
        userId: p.userId,
        valid: false,
        word: p.verdict.word,
        reason: p.verdict.reason,
        points: 0,
        streakAfter: 0,
        first: false,
        stolen: 0,
      };
    }
    const streakAfter = p.streakBefore + 1;
    const lengthBonus = Math.min(
      CONFIG.lengthBonusCap,
      Math.max(0, p.verdict.word.length - 5) * CONFIG.lengthBonusPerLetter,
    );
    const speed = p.userId === fastestId ? CONFIG.speedBonus : 0;
    const raw =
      (CONFIG.baseScore + speed + lengthBonus) *
      streakMultiplier(streakAfter) *
      spec.pointsMultiplier;
    const steals =
      spec.modifier === "steal" && p.answerMs != null && p.answerMs <= CONFIG.stealWithinMs;
    return {
      userId: p.userId,
      valid: true,
      word: p.verdict.word,
      reason: "ok" as Reason,
      points: Math.round(raw),
      streakAfter,
      first: p.userId === fastestId,
      stolen: steals ? CONFIG.stealAmount : 0,
    };
  });
}

export function applyRound(
  scores: Record<string, number>,
  results: PlayerRoundResult[],
): Record<string, number> {
  const next = { ...scores };
  for (const r of results) next[r.userId] = (next[r.userId] ?? 0) + r.points + r.stolen;
  for (const r of results) {
    if (r.stolen > 0) {
      const victim = results.find((x) => x.userId !== r.userId);
      if (victim) next[victim.userId] = Math.max(0, (next[victim.userId] ?? 0) - r.stolen);
    }
  }
  return next;
}

/** Odd rounds: p1 picks START, p2 picks END. Even rounds swap. */
export function rolesForRound(round: number, p1: string, p2: string) {
  return round % 2 === 1
    ? { startPicker: p1, endPicker: p2 }
    : { startPicker: p2, endPicker: p1 };
}

/** Chain mode: last letter of the fastest valid word, or null if the chain broke. */
export function chainCarry(
  rs: { word: string; valid: boolean; answerMs: number | null }[],
): string | null {
  const v = rs
    .filter((r) => r.valid && r.word)
    .sort((a, b) => (a.answerMs ?? Infinity) - (b.answerMs ?? Infinity));
  return v.length ? v[0].word[v[0].word.length - 1] : null;
}

export function matchWinner(scores: Record<string, number>): string | null {
  const e = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (e.length < 2 || e[0][1] === e[1][1]) return null;
  return e[0][0];
}

export function wildcardBanner(spec: RoundSpec): string | null {
  if (spec.modifier === "long_word") return "2x - 7+ letters";
  if (spec.modifier === "vowel_ban") return "No A or O";
  if (spec.modifier === "steal") return "Steal: answer in under 1s";
  return null;
}

export const BOMB = {
  fuseMs: 30000,
  correctBonusMs: 2000,
  wrongPenaltyMs: 2000,
  maxFuseMs: 40000,
  pickMs: 3000,
} as const;

export interface BombState {
  fuseLeftMs: number;
  holder: string;
  passer: string;
  start: string;
  end: string | null;
  used: string[];
  words: Record<string, number>;
  longest: Record<string, string>;
  exploded: boolean;
  loser: string | null;
  turn: number;
}

export function bombInit(holder: string, passer: string, startLetter: string): BombState {
  return {
    fuseLeftMs: BOMB.fuseMs,
    holder,
    passer,
    start: startLetter,
    end: null,
    used: [],
    words: { [holder]: 0, [passer]: 0 },
    longest: { [holder]: "", [passer]: "" },
    exploded: false,
    loser: null,
    turn: 1,
  };
}

export function bombSetEnd(s: BombState, endLetter: string): BombState {
  return { ...s, end: endLetter };
}

export interface BombResolution {
  state: BombState;
  event: "passed" | "retry" | "exploded";
}

/** Resolve a holder attempt using elapsed time measured by the server. */
export function bombResolve(s: BombState, verdict: Verdict, usedMs: number): BombResolution {
  if (s.exploded) return { state: s, event: "exploded" };
  const afterTime = s.fuseLeftMs - Math.max(0, usedMs);
  if (afterTime <= 0) {
    return { state: { ...s, fuseLeftMs: 0, exploded: true, loser: s.holder }, event: "exploded" };
  }
  if (!verdict.valid) {
    const afterPenalty = afterTime - BOMB.wrongPenaltyMs;
    if (afterPenalty <= 0) {
      return { state: { ...s, fuseLeftMs: 0, exploded: true, loser: s.holder }, event: "exploded" };
    }
    return { state: { ...s, fuseLeftMs: afterPenalty }, event: "retry" };
  }
  const word = verdict.word;
  const longest = word.length > (s.longest[s.holder] ?? "").length ? word : s.longest[s.holder] ?? "";
  return {
    state: {
      ...s,
      fuseLeftMs: Math.min(BOMB.maxFuseMs, afterTime + BOMB.correctBonusMs),
      holder: s.passer,
      passer: s.holder,
      start: word[word.length - 1],
      end: null,
      used: [...s.used, word],
      words: { ...s.words, [s.holder]: (s.words[s.holder] ?? 0) + 1 },
      longest: { ...s.longest, [s.holder]: longest },
      turn: s.turn + 1,
    },
    event: "passed",
  };
}

export function bombSpec(s: BombState): RoundSpec {
  return {
    round: s.turn,
    mode: "classic",
    start: s.start,
    end: s.end ?? "e",
    mines: [],
    banned: [],
    minLength: CONFIG.minLength,
    modifier: "none",
    pointsMultiplier: 1,
    rerolled: false,
  };
}
