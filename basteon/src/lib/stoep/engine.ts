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
  if (!cand.length || r.guesses >= 4) return { kind: "stuck" };

  const total = cand.reduce((s, c) => s + c.w, 0);
  const top = cand[0];
  const used = questionsAsked(r);
  const budget = 7 + (r.guesses > 0 ? 1 : 0);
  const confidence = top.w / Math.max(total, 0.0001);

  if (used >= budget || cand.length === 1 || (used >= 4 && confidence >= 0.58) || confidence >= 0.74) {
    return { kind: "guess", label: top.o.label };
  }

  let best: { q: Q; e: number } | null = null;
  for (const q of QS) {
    if (r.asked.includes(q.id) || !q.senses.includes(r.sense)) continue;
    const yes = cand.reduce((s, c) => s + (q.test(c.o) ? c.w : 0), 0) / total;
    const e = entropy(yes);
    if (!best || e > best.e) best = { q, e };
  }

  if (!best || best.e < 0.11) return { kind: "guess", label: top.o.label };
  return { kind: "ask", id: best.q.id, text: best.q.text };
}

/* ---------- Understanding free-text answers ---------- */
export function parseYesNo(text: string): "yes" | "no" | "maybe" {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim()} `;
  if (/\b(not sure|maybe|kinda|kind of|sort of|idk|dunno|don'?t know|unsure|perhaps|i guess|hard to say|not really sure)\b/.test(t)) return "maybe";
  if (/\b(no|nope|nah|nay|negative|not really|not at all|wrong guess|incorrect)\b/.test(t)) return "no";
  if (/\b(yes|yeah|yep|yup|ya|yea|sure|correct|right|exactly|definitely|absolutely|it is|that's it|that is it|you got it|spot on|mhm|uh huh|ok|okay)\b/.test(t)) return "yes";
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

function noteFactsFromText(next: Round, text: string) {
  const t = ` ${norm(text)} `;
  const setFact = (id: string, value: boolean) => {
    next.facts[id] = value;
    if (!next.asked.includes(id)) next.asked.push(id);
  };

  const has = (re: RegExp) => re.test(t);
  if (has(/\b(blue|navy|azure)\b/)) setFact("c:blue", true);
  if (has(/\b(green|olive|lime)\b/)) setFact("c:green", true);
  if (has(/\b(white|pale)\b/)) setFact("c:white", true);
  if (has(/\b(black|dark)\b/)) setFact("c:black", true);
  if (has(/\b(brown|wooden|tan|beige)\b/)) setFact("c:brown", true);

  if (has(/\b(table|desk|shelf|counter|surface|top)\b/)) setFact("z:surface", true);
  if (has(/\b(window|curtain|blind)\b/)) setFact("z:window", true);
  if (has(/\b(floor|ground|tile|carpet|rug)\b/)) setFact("z:floor", true);
  if (has(/\b(wall|poster|frame)\b/)) setFact("z:wall", true);
  if (has(/\b(ceiling|roof|fan above)\b/)) setFact("z:ceiling", true);
  if (has(/\b(hand|holding|wearing|touching|in my pocket|on me)\b/)) setFact("z:body", true);

  if (has(/\b(move|moving|vibrat|shak|rolling|walking)\b/)) setFact("f:moves", true);
  if (has(/\b(still|static|not moving|doesn't move|doesnt move)\b/)) setFact("f:moves", false);

  if (has(/\b(light|bright|glow|lit|shiny)\b/)) setFact("f:light", true);
  if (has(/\b(dark|not lit|no light|dim)\b/)) setFact("f:light", false);

  if (has(/\b(soft|fluffy|squishy|smooth)\b/)) setFact("f:soft", true);
  if (has(/\b(hard|rough|solid|sharp)\b/)) setFact("f:soft", false);

  if (has(/\b(noisy|loud|buzz|ring|humm|tick|talk|voice|music|song|sound)\b/)) setFact("f:noisy", true);
  if (has(/\b(quiet|silent|no sound)\b/)) setFact("f:noisy", false);

  if (has(/\b(warm|hot|heated)\b/)) setFact("f:warm", true);
  if (has(/\b(cold|cool|chilly|icy)\b/)) setFact("f:cold", true);
  if (has(/\b(big|large|huge|massive)\b/)) setFact("f:big", true);
  if (has(/\b(alive|animal|person|human|pet|dog|cat|bird)\b/)) setFact("f:alive", true);
  if (has(/\b(outside|far away|distant|across)\b/)) setFact("f:far", true);
  if (has(/\b(food|drink|coffee|tea|snack|meal|fruit)\b/)) setFact("f:food", true);
  if (has(/\b(fresh|clean|minty)\b/)) setFact("f:fresh", true);
  if (has(/\b(steady|constant|continuous)\b/)) setFact("f:steady", true);
  if (has(/\b(voice|voices|talking|music|song|speech)\b/)) setFact("f:speech", true);
}

function inferObjectGuess(text: string, r: Round): string | undefined {
  const clue = base(text);
  if (!clue || clue.length < 2) return undefined;

  let best: { label: string; score: number } | null = null;
  for (const o of OBJECTS) {
    if (!o.senses.includes(r.sense) || r.rejected.includes(o.label)) continue;
    const aliases = [o.label, ...o.alias];
    let score = 0;
    for (const a of aliases) {
      const normAlias = base(a);
      if (!normAlias) continue;
      if (same(clue, normAlias)) score = Math.max(score, 1);
      else if ((clue.length >= 4 && wordIn(clue, normAlias)) || (normAlias.length >= 4 && wordIn(normAlias, clue))) score = Math.max(score, 0.86);
      else {
        const clueTokens = clue.split(" ");
        const aliasTokens = normAlias.split(" ");
        const overlap = clueTokens.filter((t) => aliasTokens.includes(t)).length;
        const ratio = overlap / Math.max(1, aliasTokens.length);
        if (ratio >= 0.66 && overlap > 0) score = Math.max(score, 0.7);
      }
    }

    if (score > 0) {
      if (r.setting && r.setting !== "other") {
        if (o.any) score *= 0.95;
        else if (o.at.includes(r.setting)) score *= 1.08;
        else score *= 0.62;
      }
      if (r.posture && o.postures.length && !o.postures.includes(r.posture)) score *= 0.78;
    }

    if (score > (best?.score ?? 0)) best = { label: o.label, score };
  }

  return best && best.score >= 0.68 ? best.label : undefined;
}
export function applyAnswer(r: Round, m: Move, text: string): { round: Round; ok: boolean; yes?: boolean; inferredGuess?: string } {
  const next: Round = { ...r, facts: { ...r.facts }, asked: [...r.asked], rejected: [...r.rejected] };
  const inferredSetting = parseSetting(text);
  const inferredPosture = parsePosture(text);

  if (inferredSetting && !next.setting) next.setting = inferredSetting;
  if (inferredPosture && !next.posture) next.posture = inferredPosture;

  noteFactsFromText(next, text);
  const inferredGuess = inferObjectGuess(text, next);

  if (m.kind === "setting") {
    next.settingAsked = true;
    const s = parseSetting(text);
    next.setting = s ?? next.setting ?? "other";
    return { round: next, ok: !!s || !!inferredSetting, inferredGuess };
  }

  if (m.kind === "posture") {
    next.postureAsked = true;
    const p = parsePosture(text);
    if (p) next.posture = p;
    return { round: next, ok: !!p || !!inferredPosture, inferredGuess };
  }

  if (m.kind === "ask") {
    next.asked.push(m.id);
    const a = parseYesNo(text);
    if (a !== "maybe") next.facts[m.id] = a === "yes";
    return { round: next, ok: a !== "maybe" || !!inferredGuess, yes: a === "yes", inferredGuess };
  }

  if (m.kind === "guess") {
    const answer = parseYesNo(text);
    if (answer === "yes" || same(text, m.label)) return { round: next, ok: true, yes: true, inferredGuess };

    if (inferredGuess && !same(inferredGuess, m.label) && !next.rejected.some((x) => same(x, inferredGuess))) {
      next.guesses++;
      next.rejected.push(m.label);
      return { round: next, ok: true, yes: false, inferredGuess };
    }

    next.guesses++;
    next.rejected.push(m.label);
    return { round: next, ok: true, yes: false, inferredGuess };
  }

  return { round: next, ok: true, inferredGuess };
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
    case "setting":
      return pickOne([
        "Paint me the scene first: where are you right now?",
        "Set the stage for me — are you in a room, in a car, or outside?",
      ]);
    case "posture":
      return pickOne([
        "Quick body clue: are you lying down, sitting, or standing?",
        "What posture are you in right now — lying, sitting, or standing?",
      ]);
    case "ask":
      return m.text;
    case "guess":
      return pickOne([
        `I think I've got it… ${guessText(m.label, r.sense)}`,
        `Let me lock in a guess: ${guessText(m.label, r.sense)}`,
      ]);
    case "reveal":
      return "You outsmarted me this round. What was it?";
    default:
      return "Hmm.";
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
