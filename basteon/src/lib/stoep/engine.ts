import {
  OBJECTS, SETTINGS, TASTES, THINGS,
  type Color, type Entry, type Flag, type Obj, type Posture, type SenseKey, type SettingId, type Zone,
} from "./knowledge";

/* =========================================================
   Text helpers
   ========================================================= */
export const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(a|an|the|my|some|our|his|her)\b/g, " ").replace(/\s+/g, " ").trim();
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const base = (s: string) => norm(s).split(" ").filter(Boolean).map(singular).join(" ");

function lev(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const wordIn = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

/** Loose match: "blue mug" ~ "mug", "pillows" ~ "pillow", "sofaa" ~ "sofa". */
export function same(a: string, b: string) {
  const x = base(a), y = base(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if ((x.length >= 3 && wordIn(y, x)) || (y.length >= 3 && wordIn(x, y))) return true;
  return Math.max(x.length, y.length) > 4 && lev(x, y) <= 1;
}

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickOne = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** Very small safety net: if someone types something that sounds unsafe, offer a human. */
export const needsPerson = (text: string) =>
  /(kill myself|suicid|end my life|want to die|hurt myself|self.?harm|being (followed|attacked|abused|hit)|not safe|someone is (following|hurting)|in danger|raped|he'?s hitting|he'?s hurting)/i.test(text);

/* =========================================================
   Mode 1: guess what the person typed, from their setting
   ========================================================= */
export type Guess = { label: string; alias: string[] };
export const GUESS_COUNT: Record<SenseKey, number> = { see: 8, feel: 6, hear: 5, smell: 4, taste: 4 };
const SENSE_KEYS = Object.keys(GUESS_COUNT) as SenseKey[];

const inTime = (e: Entry, night: boolean) => !e.when || (e.when === "night") === night;

function sample(pool: Entry[], n: number, skip: Set<string>, noise = 0.45) {
  return pool
    .filter((e) => !skip.has(e.label))
    .map((e) => ({ e, s: e.w * (1 - noise / 2 + Math.random() * noise) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.e);
}

function allPool(sense: SenseKey, night: boolean, except?: SettingId) {
  const seen = new Map<string, Entry>();
  for (const s of SETTINGS) {
    if (s.id === except) continue;
    for (const e of THINGS[s.id][sense] ?? []) if (inTime(e, night) && !seen.has(e.label)) seen.set(e.label, { ...e, w: 3 });
  }
  return [...seen.values()];
}

/**
 * Kiki's guesses for each sense. ~70% are the most likely things for the setting,
 * ~30% are decoys from other places so there is always something to pop.
 * Taste ignores the setting: it comes from memory, so Kiki guesses common favourites.
 */
export function buildGuesses(setting: SettingId | "other", night: boolean, extra?: Partial<Record<SenseKey, string[]>>) {
  const out = {} as Record<SenseKey, Guess[]>;
  for (const sense of SENSE_KEYS) {
    const n = GUESS_COUNT[sense];
    let main: Entry[];
    let decoys: Entry[];
    if (sense === "taste") {
      main = TASTES;
      decoys = [];
    } else if (setting === "other") {
      const ai = (extra?.[sense] ?? []).map((label) => ({ label, w: 6, alias: [] as string[] }));
      main = ai.length ? ai : allPool(sense, night);
      decoys = allPool(sense, night);
    } else {
      main = (THINGS[setting][sense] ?? []).filter((e) => inTime(e, night));
      decoys = allPool(sense, night, setting);
    }
    const decoyN = sense === "taste" ? 0 : Math.max(1, Math.round(n * 0.3));
    const real = sample(main, n - decoyN, new Set());
    const used = new Set([...real.map((e) => e.label), ...main.map((e) => e.label)]);
    const fake = sample(decoys, decoyN, used, 1.6);
    out[sense] = shuffle([...real, ...fake]).map((e) => ({ label: e.label, alias: e.alias }));
  }
  return out;
}

export const matchesGuess = (typed: string, g: Guess) => [g.label, ...g.alias].some((a) => same(typed, a));

export type SenseResult = { hits: Guess[]; total: number; mine: number; surprises: string[] };
export function scoreSense(typed: string[], guesses: Guess[]): SenseResult {
  const hits = guesses.filter((g) => typed.some((t) => matchesGuess(t, g)));
  const surprises = typed.filter((t) => !guesses.some((g) => matchesGuess(t, g)));
  return { hits, total: guesses.length, mine: typed.length, surprises };
}

/* =========================================================
   Mode 2: Kiki asks up to ~5 questions, then guesses
   ========================================================= */
export type Round = {
  sense: SenseKey;
  setting?: SettingId | "other";
  posture?: Posture;
  facts: Record<string, boolean>;
  asked: string[];
  rejected: string[];
  guesses: number;
  settingAsked: boolean;
  postureAsked: boolean;
  aiTried: boolean;
};
export type Move =
  | { kind: "setting" }
  | { kind: "posture" }
  | { kind: "ask"; id: string; text: string }
  | { kind: "guess"; label: string }
  | { kind: "reveal" }
  | { kind: "stuck" };

export const newRound = (sense: SenseKey): Round => ({
  sense, facts: {}, asked: [], rejected: [], guesses: 0, settingAsked: false, postureAsked: false, aiTried: false,
});
export const questionsAsked = (r: Round) => r.asked.length + (r.settingAsked ? 1 : 0) + (r.postureAsked ? 1 : 0);

type Q = { id: string; text: string; senses: SenseKey[]; test: (o: Obj) => boolean };
const LOOK: SenseKey[] = ["see", "feel"];
const ZONE_TEXT: Record<Zone, string> = {
  ceiling: "Is it on the ceiling?", wall: "Is it on a wall?", floor: "Is it on the floor, or standing on it?",
  surface: "Is it sitting on a table, desk or shelf?", window: "Is it near a window?",
  body: "Are you holding it, wearing it or touching it?", air: "Is it in the air around you?",
};
const FLAG_Q: Record<Flag, [string, SenseKey[]]> = {
  moves: ["Does it move?", ["see", "feel", "hear"]], light: ["Does it glow or give off light?", LOOK],
  soft: ["Is it soft?", LOOK], noisy: ["Does it make a sound?", LOOK], warm: ["Is it warm?", ["see", "feel", "smell"]],
  cold: ["Is it cold?", ["feel", "hear"]], big: ["Is it bigger than a loaf of bread?", LOOK],
  alive: ["Is it alive, like a person or an animal?", ["see", "feel", "hear"]],
  far: ["Is it coming from far away, or outside?", ["hear"]], food: ["Is it connected to food or a drink?", ["smell"]],
  fresh: ["Is it a fresh, clean kind of smell?", ["smell"]], steady: ["Is it a steady hum, tick or buzz?", ["hear"]],
  speech: ["Is it voices or music?", ["hear"]],
};
const COLORS: Color[] = ["white", "brown", "black", "green", "blue"];

const QS: Q[] = [
  ...(Object.keys(ZONE_TEXT) as Zone[]).map((z) => ({ id: `z:${z}`, text: ZONE_TEXT[z], senses: LOOK, test: (o: Obj) => o.zone === z })),
  ...(Object.keys(FLAG_Q) as Flag[]).map((f) => ({ id: `f:${f}`, text: FLAG_Q[f][0], senses: FLAG_Q[f][1], test: (o: Obj) => o.flags.includes(f) })),
  ...COLORS.map((c) => ({ id: `c:${c}`, text: `Is it mostly ${c}?`, senses: LOOK, test: (o: Obj) => o.colors.includes(c) })),
];
const QMAP = Object.fromEntries(QS.map((q) => [q.id, q]));

function weight(o: Obj, r: Round) {
  let w = 1;
  if (r.setting && r.setting !== "other") w *= o.any ? 0.7 : o.at.includes(r.setting) ? 1 : 0.02;
  if (r.posture && o.postures.length && !o.postures.includes(r.posture)) w *= 0.15;
  for (const [id, val] of Object.entries(r.facts)) if (QMAP[id] && QMAP[id].test(o) !== val) w *= 0.04;
  return w;
}
export function rank(r: Round) {
  return OBJECTS.filter((o) => o.senses.includes(r.sense) && !r.rejected.includes(o.label))
    .map((o) => ({ o, w: weight(o, r) }))
    .filter((x) => x.w > 0.001)
    .sort((a, b) => b.w - a.w);
}
const entropy = (p: number) => (p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)));

export function nextMove(r: Round): Move {
  if (!r.settingAsked) return { kind: "setting" };
  if (!r.postureAsked && (r.sense === "see" || r.sense === "feel")) return { kind: "posture" };
  const cand = rank(r);
  if (!cand.length || r.guesses >= 3) return { kind: "stuck" };
  const total = cand.reduce((s, c) => s + c.w, 0);
  const top = cand[0];
  const used = questionsAsked(r);
  const budget = 5 + (r.guesses > 0 ? 1 : 0);
  if (used >= budget || cand.length === 1 || (used >= 3 && top.w / total >= 0.5)) return { kind: "guess", label: top.o.label };

  let best: { q: Q; e: number } | null = null;
  for (const q of QS) {
    if (r.asked.includes(q.id) || !q.senses.includes(r.sense)) continue;
    const yes = cand.reduce((s, c) => s + (q.test(c.o) ? c.w : 0), 0) / total;
    const e = entropy(yes);
    if (!best || e > best.e) best = { q, e };
  }
  if (!best || best.e < 0.15) return { kind: "guess", label: top.o.label };
  return { kind: "ask", id: best.q.id, text: best.q.text };
}

/* ---------- Understanding free-text answers ---------- */
export function parseYesNo(text: string): "yes" | "no" | "maybe" {
  const t = text.toLowerCase();
  if (/\b(not sure|maybe|kinda|kind of|sort of|idk|dunno|don'?t know|unsure|perhaps|i guess|hard to say)\b/.test(t)) return "maybe";
  if (/^\s*(no|nope|nah|nay|negative)\b|\bnot\b|\bno\b|n't\b/.test(t)) return "no";
  if (/\b(yes|yeah|yep|yup|ya|yea|sure|correct|right|exactly|it is|definitely|uh huh|mhm|ok|okay|y)\b/.test(t)) return "yes";
  return "maybe";
}
export function parseSetting(text: string): SettingId | null {
  const t = ` ${norm(text)} `;
  let best: { id: SettingId; len: number } | null = null;
  for (const s of SETTINGS)
    for (const w of s.words) if (t.includes(` ${w} `) || t.includes(` ${w}s `) ? w.length > (best?.len ?? 0) : false) best = { id: s.id, len: w.length };
  return best?.id ?? null;
}
export function parsePosture(text: string): Posture | null {
  const t = text.toLowerCase();
  if (/\b(lying|laying|lie|lay|in bed|flat)\b/.test(t)) return "lying";
  if (/\b(sit|sitting|seated|sat|couch|chair)\b/.test(t)) return "sitting";
  if (/\b(stand|standing|walking|walk|on my feet)\b/.test(t)) return "standing";
  return null;
}

export function applyAnswer(r: Round, m: Move, text: string): { round: Round; ok: boolean; yes?: boolean } {
  const next: Round = { ...r, facts: { ...r.facts }, asked: [...r.asked], rejected: [...r.rejected] };
  if (m.kind === "setting") {
    next.settingAsked = true;
    const s = parseSetting(text);
    next.setting = s ?? "other";
    return { round: next, ok: !!s };
  }
  if (m.kind === "posture") {
    next.postureAsked = true;
    const p = parsePosture(text);
    if (p) next.posture = p;
    return { round: next, ok: !!p };
  }
  if (m.kind === "ask") {
    next.asked.push(m.id);
    const a = parseYesNo(text);
    if (a !== "maybe") next.facts[m.id] = a === "yes";
    return { round: next, ok: a !== "maybe", yes: a === "yes" };
  }
  if (m.kind === "guess") {
    if (parseYesNo(text) === "yes") return { round: next, ok: true, yes: true };
    next.guesses++;
    next.rejected.push(m.label);
    return { round: next, ok: true, yes: false };
  }
  return { round: next, ok: true };
}

/* ---------- Kiki's voice ---------- */
const uncountable = /^(traffic|wind|rain|music|grass|cooking|hair|coffee|fuel|soap|my breathing|old paper|footsteps|voices|birds|books|hands|clothes|keys|curtains)$/;
export function guessText(label: string, sense: SenseKey) {
  const art = uncountable.test(label) || label.endsWith("s") ? "" : /^[aeiou]/.test(label) ? "an " : "a ";
  const the = sense === "hear" || sense === "smell" ? "" : "";
  return `Is it ${the}${art}${label}?`;
}
export function describeMove(m: Move, r: Round): string {
  switch (m.kind) {
    case "setting": return pickOne(["First things first: where are you right now?", "Where are you? A room, a car, outside?"]);
    case "posture": return "Are you lying down, sitting or standing?";
    case "ask": return m.text;
    case "guess": return guessText(m.label, r.sense);
    case "reveal": return "You got me! What was it?";
    default: return "Hmm.";
  }
}
export function reaction(m: Move, res: { ok: boolean; yes?: boolean }, r: Round): string {
  if (m.kind === "setting") {
    const name = r.setting && r.setting !== "other" ? SETTINGS.find((s) => s.id === r.setting)?.name.toLowerCase() : null;
    return name ? pickOne([`A ${name}. I can picture it.`, `Ooh, a ${name}. Cosy.`]) : "Hm, I can't quite place that, but I'll work with it.";
  }
  if (m.kind === "posture") return res.ok ? pickOne(["Got it.", "Okay, that helps."]) : "No stress, skipping that one.";
  if (m.kind === "ask") {
    if (!res.ok) return pickOne(["Hard to say. That's okay.", "Fair, let's move on."]);
    return res.yes ? pickOne(["Ooh, interesting.", "Yes! Now we're getting somewhere.", "I like that."]) : pickOne(["Okay, not that.", "Good to know.", "Ruling that out."]);
  }
  if (m.kind === "guess") return "Ah, not that one. Let me think again.";
  return "";
}
export const article = (label: string) => (uncountable.test(label) || label.endsWith("s") ? "" : /^[aeiou]/.test(label) ? "an " : "a ");