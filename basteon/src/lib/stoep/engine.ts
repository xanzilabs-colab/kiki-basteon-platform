import {
  DESCRIPTORS,
  OBJECTS,
  SETTINGS,
  SYNONYMS,
  TASTES,
  THINGS,
  type Color,
  type Descriptor,
  type Entry,
  type Flag,
  type Obj,
  type Posture,
  type SenseKey,
  type SettingId,
  type Zone,
} from "./knowledge";
import { classify, normalize, type UnderstandIntent } from "./understand";

export const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(a|an|the|my|some|our|his|her)\b/g, " ").replace(/\s+/g, " ").trim();
const singular = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const base = (s: string) => norm(s).split(" ").filter(Boolean).map(singular).join(" ");
const wordIn = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

function lev(a: string, b: string) {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

export function same(a: string, b: string) {
  const x = base(a);
  const y = base(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if ((x.length >= 3 && wordIn(y, x)) || (y.length >= 3 && wordIn(x, y))) return true;
  return Math.max(x.length, y.length) > 4 && lev(x, y) <= 1;
}

const pickOne = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = <T,>(arr: T[]) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const needsPerson = (text: string) =>
  /(kill myself|suicid|end my life|want to die|hurt myself|self.?harm|being (followed|attacked|abused|hit)|not safe|someone is (following|hurting)|in danger|raped|he'?s hitting|he'?s hurting)/i.test(text);

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
  for (const setting of SETTINGS) {
    if (setting.id === except) continue;
    for (const e of THINGS[setting.id][sense] ?? []) if (inTime(e, night) && !seen.has(e.label)) seen.set(e.label, { ...e, w: 3 });
  }
  return [...seen.values()];
}
export function buildGuesses(setting: SettingId | "other", night: boolean, extra?: Partial<Record<SenseKey, string[]>>) {
  const out = {} as Record<SenseKey, Guess[]>;
  for (const sense of SENSE_KEYS) {
    const n = GUESS_COUNT[sense];
    let main: Entry[] = [];
    let decoys: Entry[] = [];
    if (sense === "taste") {
      main = TASTES;
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

export type RoundTurn = { role: "kiki" | "you"; text: string };
export type Round = {
  sense: SenseKey;
  setting?: SettingId | "other";
  posture?: Posture;
  facts: Record<string, boolean>;
  asked: string[];
  rejected: string[];
  rejectedOptions: string[];
  descriptors: Descriptor[];
  guesses: number;
  settingAsked: boolean;
  postureAsked: boolean;
  aiTried: boolean;
  lastQuestion?: { id: string; text: string; options?: [string, string] };
  turns: RoundTurn[];
};
export type Move =
  | { kind: "setting" }
  | { kind: "posture" }
  | { kind: "ask"; id: string; text: string; options?: [string, string] }
  | { kind: "guess"; label: string }
  | { kind: "reveal" }
  | { kind: "stuck" };

export type ApplyAnswerResult = {
  round: Round;
  ok: boolean;
  yes?: boolean;
  inferredGuess?: string;
  intent?: UnderstandIntent;
  reveal?: string;
  reply?: string;
};

export const newRound = (sense: SenseKey): Round => ({
  sense,
  facts: {},
  asked: [],
  rejected: [],
  rejectedOptions: [],
  descriptors: [],
  guesses: 0,
  settingAsked: false,
  postureAsked: false,
  aiTried: false,
  turns: [],
});

export const questionsAsked = (r: Round) => r.asked.length;

type Q = {
  id: string;
  text: string;
  senses: SenseKey[];
  mode: "binary" | "choice";
  options?: [string, string];
  test: (o: Obj) => boolean;
  answerFromDescriptors?: (descriptors: Descriptor[]) => boolean | null;
};
const LOOK: SenseKey[] = ["see", "feel"];
const ZONE_TEXT: Record<Zone, string> = {
  ceiling: "Is it on the ceiling?",
  wall: "Is it on a wall?",
  floor: "Is it on the floor, or standing on it?",
  surface: "Is it on a table, desk, shelf, or counter?",
  window: "Is it near a window?",
  body: "Are you holding it, wearing it, or touching it?",
  air: "Is it in the air around you?",
};
const FLAG_Q: Record<Flag, [string, SenseKey[]]> = {
  moves: ["Does it move?", ["see", "feel", "hear"]],
  light: ["Does it glow or give off light?", LOOK],
  soft: ["Is it soft?", LOOK],
  noisy: ["Is it making a sound?", LOOK],
  warm: ["Does it feel warm?", ["feel", "smell", "taste"]],
  cold: ["Does it feel cold?", ["feel", "smell", "taste"]],
  big: ["Is it bigger than a loaf of bread?", LOOK],
  alive: ["Is it alive, like a person or an animal?", ["see", "feel", "hear"]],
  far: ["Does it feel far away or outside?", ["hear", "smell"]],
  food: ["Is it related to food or drink?", ["smell", "taste"]],
  fresh: ["Does it smell fresh or clean?", ["smell"]],
  steady: ["Is it steady and continuous?", ["hear"]],
  speech: ["Is it voices or music?", ["hear"]],
};
const COLORS: Color[] = ["white", "brown", "black", "green", "blue"];
const descriptorToFlag: Partial<Record<Descriptor, string>> = {
  loud: "f:noisy",
  quiet: "f:noisy",
  warm: "f:warm",
  cold: "f:cold",
  fresh: "f:fresh",
  soft: "f:soft",
  smooth: "f:soft",
  rough: "f:soft",
  rhythmic: "f:steady",
};

const QS: Q[] = [
  ...(Object.keys(ZONE_TEXT) as Zone[]).map((zone) => ({
    id: `z:${zone}`,
    text: ZONE_TEXT[zone],
    senses: LOOK,
    mode: "binary" as const,
    test: (o: Obj) => o.zone === zone,
  })),
  ...(Object.keys(FLAG_Q) as Flag[]).map((flag) => ({
    id: `f:${flag}`,
    text: FLAG_Q[flag][0],
    senses: FLAG_Q[flag][1],
    mode: flag === "speech" ? ("choice" as const) : ("binary" as const),
    options: flag === "speech" ? (["voices", "music"] as [string, string]) : undefined,
    test: (o: Obj) => (flag === "speech" ? o.label === "voices" || o.label === "music" : o.flags.includes(flag)),
  })),
  ...COLORS.map((color) => ({
    id: `c:${color}`,
    text: `Is it mostly ${color}?`,
    senses: LOOK,
    mode: "binary" as const,
    test: (o: Obj) => o.colors.includes(color),
  })),
  {
    id: "d:fruity",
    text: "Would you call the smell fruity?",
    senses: ["smell"],
    mode: "binary",
    test: (o) => o.descriptors.includes("fruity"),
  },
  {
    id: "d:smoky",
    text: "Does it smell smoky or burnt?",
    senses: ["smell"],
    mode: "binary",
    test: (o) => o.descriptors.includes("smoky") || o.descriptors.includes("burnt"),
  },
  {
    id: "d:soapy",
    text: "Is it more soapy or cleaner-like?",
    senses: ["smell"],
    mode: "binary",
    test: (o) => o.descriptors.includes("soapy"),
  },
  {
    id: "h:human-machine",
    text: "Does it sound more human or more machine-like?",
    senses: ["hear"],
    mode: "choice",
    options: ["human", "machine"],
    test: (o) => o.flags.includes("speech") || o.label.includes("voice"),
  },
];
const QMAP = Object.fromEntries(QS.map((q) => [q.id, q]));

function detectDescriptors(text: string) {
  const parsed = classify(text);
  return parsed.entities.descriptors;
}

function descriptorContradiction(descriptor: Descriptor): Descriptor | null {
  const pairs: Array<[Descriptor, Descriptor]> = [
    ["warm", "cold"],
    ["loud", "quiet"],
    ["soft", "rough"],
    ["fresh", "musty"],
    ["sweet", "sour"],
  ];
  for (const [a, b] of pairs) {
    if (descriptor === a) return b;
    if (descriptor === b) return a;
  }
  return null;
}

function weight(o: Obj, r: Round) {
  let w = 1;
  if (r.setting && r.setting !== "other") w *= o.any ? 0.72 : o.at.includes(r.setting) ? 1.12 : 0.05;
  if (r.posture && o.postures.length) w *= o.postures.includes(r.posture) ? 1.07 : 0.62;
  for (const [id, value] of Object.entries(r.facts)) {
    const q = QMAP[id];
    if (!q) continue;
    const truth = q.test(o);
    if (q.mode === "choice" && q.id === "f:speech" && id === "f:speech") {
      const isVoices = o.label === "voices";
      if (value ? isVoices : !isVoices) w *= 4;
      else w *= 0.04;
      continue;
    }
    w *= truth === value ? 1.9 : 0.06;
  }

  const objectDescriptors = new Set(o.descriptors);
  for (const descriptor of r.descriptors) {
    if (objectDescriptors.has(descriptor)) w *= 4;
    else if (descriptorContradiction(descriptor) && objectDescriptors.has(descriptorContradiction(descriptor)!)) w *= 0.04;
  }
  if (r.rejected.some((x) => same(x, o.label))) w *= 0.001;
  return w;
}

export function rank(r: Round) {
  return OBJECTS
    .filter((o) => o.senses.includes(r.sense))
    .map((o) => ({ o, w: weight(o, r) }))
    .filter((x) => x.w > 0.00001)
    .sort((a, b) => b.w - a.w);
}

function entropy(p: number) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function canAskQuestion(q: Q, r: Round) {
  if (r.asked.includes(q.id)) return false;
  if (!q.senses.includes(r.sense)) return false;
  if (r.facts[q.id] !== undefined) return false;
  if (q.id.startsWith("f:") && r.descriptors.some((d) => descriptorToFlag[d] === q.id)) return false;
  if (r.sense === "smell" && r.descriptors.includes("fruity") && (q.id === "f:food" || q.id === "f:fresh")) return false;
  if (q.id.startsWith("c:")) {
    const color = q.id.replace("c:", "");
    if (r.descriptors.includes(color as Descriptor)) return false;
  }
  if (r.sense === "smell" && q.id === "f:moves") return false;
  return true;
}

export function nextMove(r: Round): Move {
  if (!r.settingAsked) return { kind: "setting" };
  if (!r.postureAsked && (r.sense === "see" || r.sense === "feel")) return { kind: "posture" };

  const cand = rank(r);
  if (!cand.length) return { kind: "stuck" };
  const total = cand.reduce((sum, c) => sum + c.w, 0);
  const top = cand[0];
  const confidence = top.w / Math.max(total, 0.0001);

  if (confidence >= 0.76 || r.asked.length >= 7) return { kind: "guess", label: top.o.label };

  const topPool = cand.slice(0, 8);
  let best: { q: Q; gain: number } | null = null;
  for (const q of QS) {
    if (!canAskQuestion(q, r)) continue;
    const yes = topPool.reduce((sum, c) => sum + (q.test(c.o) ? c.w : 0), 0) / Math.max(0.0001, topPool.reduce((sum, c) => sum + c.w, 0));
    const gain = entropy(yes);
    if (!best || gain > best.gain) best = { q, gain };
  }
  if (!best || best.gain < 0.08) return { kind: "guess", label: top.o.label };
  return { kind: "ask", id: best.q.id, text: best.q.text, options: best.q.options };
}

export function parseYesNo(text: string): "yes" | "no" | "maybe" {
  const intent = classify(text).intent;
  if (intent === "YES") return "yes";
  if (intent === "NO") return "no";
  if (intent === "PARTIAL" || intent === "UNSURE") return "maybe";
  return "maybe";
}

export function parseSetting(text: string): SettingId | "other" | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  const found = SETTINGS.find((setting) => setting.words.some((word) => same(normalized, word)));
  return found?.id ?? (normalized.includes("other") || normalized.includes("somewhere") ? "other" : null);
}

export function parsePosture(text: string): Posture | null {
  const n = normalize(text);
  if (/\b(lying|laying|lay down|on my bed)\b/.test(n)) return "lying";
  if (/\b(sitting|seated|on a chair|on the couch|at a desk)\b/.test(n)) return "sitting";
  if (/\b(standing|on my feet|upright)\b/.test(n)) return "standing";
  return null;
}

function inferObjectGuess(text: string, r: Round): string | undefined {
  const parsed = classify(text, { rejected: r.rejected });
  if (parsed.intent === "DIRECT_ANSWER" && parsed.entities.object) return parsed.entities.object;
  return undefined;
}

function pushDescriptorFacts(round: Round, descriptors: Descriptor[], colors: string[]) {
  for (const descriptor of descriptors) {
    if (!round.descriptors.includes(descriptor)) round.descriptors.push(descriptor);
    const fact = descriptorToFlag[descriptor];
    if (!fact) continue;
    if (descriptor === "quiet") round.facts[fact] = false;
    else if (descriptor === "rough") round.facts[fact] = false;
    else round.facts[fact] = true;
  }
  for (const color of colors) {
    if (["green", "blue", "brown", "white", "black"].includes(color)) round.facts[`c:${color}`] = true;
  }
}

function isChallenge(text: string) {
  const n = normalize(text);
  return n.includes("?") || /^(how|why|what|but|that's|thats)/.test(n);
}

function isAffirmativeForGuess(intent: UnderstandIntent, text: string, label: string) {
  if (intent === "YES") return true;
  if (intent !== "DIRECT_ANSWER") return false;
  const normalized = normalize(text);
  return normalized === normalize(label) || same(normalized, label);
}

export function applyAnswer(r: Round, m: Move, text: string): ApplyAnswerResult {
  const next: Round = {
    ...r,
    facts: { ...r.facts },
    asked: [...r.asked],
    rejected: [...r.rejected],
    rejectedOptions: [...r.rejectedOptions],
    descriptors: [...r.descriptors],
    turns: [...r.turns, { role: "you", text }],
  };

  const intent = classify(text, { options: m.kind === "ask" ? m.options : undefined, rejected: next.rejected });
  const inferredGuess = inferObjectGuess(text, next);
  pushDescriptorFacts(next, intent.entities.descriptors, intent.entities.colors);
  if (
    inferredGuess &&
    !(m.kind === "ask" && Boolean(m.options)) &&
    !intent.entities.descriptors.includes(inferredGuess as Descriptor) &&
    !["green", "blue", "brown", "white", "black"].includes(inferredGuess)
  ) {
    return { round: next, ok: true, inferredGuess, reveal: inferredGuess, intent: intent.intent, reply: `Ahh, ${inferredGuess}? Got it.` };
  }
  if (intent.intent === "DISTRESS") return { round: next, ok: true, intent: intent.intent, reply: "I hear you. Let's get a real person in right now." };
  if (intent.intent === "FRUSTRATION") return { round: next, ok: true, intent: intent.intent, reply: "You're right, sorry. I'll use what you gave me and guess now." };

  if (m.kind === "setting") {
    next.settingAsked = true;
    const setting = parseSetting(text);
    next.setting = setting ?? next.setting ?? "other";
    return { round: next, ok: !!setting || intent.intent === "DESCRIPTOR", intent: intent.intent, reply: setting ? `Got it — ${setting}.` : "Thanks. I'll work with that scene." };
  }

  if (m.kind === "posture") {
    next.postureAsked = true;
    const posture = parsePosture(text);
    if (posture) next.posture = posture;
    return { round: next, ok: !!posture || intent.intent === "DESCRIPTOR", intent: intent.intent, reply: posture ? `Nice, you're ${posture}.` : "No stress, I can still work with that." };
  }

  if (m.kind === "ask") {
    next.asked.push(m.id);
    next.lastQuestion = { id: m.id, text: m.text, options: m.options };

    if (m.options && intent.intent === "CHOICE") {
      if (intent.entities.choice === "neither") {
        next.rejectedOptions.push(...m.options);
        if (m.id === "f:speech") next.facts["f:speech"] = false;
        return { round: next, ok: true, yes: false, intent: intent.intent, reply: "Got it — neither of those." };
      }
      const chosen = intent.entities.choice;
      if (chosen) {
        if (m.id === "f:speech") next.facts["f:speech"] = same(chosen, "voices");
        const possibleReveal = classify(chosen, { rejected: next.rejected });
        if (possibleReveal.intent === "DIRECT_ANSWER" && possibleReveal.entities.object) {
          return { round: next, ok: true, yes: true, reveal: possibleReveal.entities.object, intent: intent.intent, reply: `Ahh, ${possibleReveal.entities.object}? Got it.` };
        }
        return { round: next, ok: true, yes: true, intent: intent.intent, reply: `${chosen}. Nice clue.` };
      }
    }

    if (intent.intent === "YES") {
      next.facts[m.id] = true;
      return { round: next, ok: true, yes: true, intent: intent.intent, reply: "Nice, that helps." };
    }
    if (intent.intent === "NO") {
      next.facts[m.id] = false;
      return { round: next, ok: true, yes: false, intent: intent.intent, reply: "Perfect, ruling that out." };
    }
    if (intent.intent === "PARTIAL") return { round: next, ok: true, yes: false, intent: intent.intent, reply: "Got it, partly. I'll thread that in." };
    if (intent.intent === "CHALLENGE") return { round: next, ok: true, yes: false, intent: intent.intent, reply: "Fair point. Thanks for correcting me." };
    if (intent.intent === "DESCRIPTOR") {
      const descriptor = intent.entities.descriptors[0] ?? intent.entities.colors[0];
      return { round: next, ok: true, yes: false, intent: intent.intent, reply: descriptor ? `${descriptor[0].toUpperCase()}${descriptor.slice(1)}. Helpful clue.` : "Good clue — I’m using that." };
    }
    return { round: next, ok: false, yes: false, intent: intent.intent, reply: "I might have missed that — give me one more hint?" };
  }

  if (m.kind === "guess") {
    if (isChallenge(text) || intent.intent === "CHALLENGE" || intent.intent === "CORRECTION") {
      if (!next.rejected.some((x) => same(x, m.label))) next.rejected.push(m.label);
      next.guesses++;
      return { round: next, ok: true, yes: false, intent: intent.intent, reply: `Fair point, ${m.label} doesn't fit that. Scratch that.` };
    }
    if (isAffirmativeForGuess(intent.intent, text, m.label)) return { round: next, ok: true, yes: true, intent: intent.intent, reply: "Yes! Lovely, thanks." };

    if (intent.intent === "DIRECT_ANSWER" && intent.entities.object && !same(intent.entities.object, m.label)) {
      if (!next.rejected.some((x) => same(x, m.label))) next.rejected.push(m.label);
      next.guesses++;
      return { round: next, ok: true, yes: false, reveal: intent.entities.object, intent: intent.intent, reply: `Ahh, ${intent.entities.object}? Got it.` };
    }

    next.guesses++;
    if (!next.rejected.some((x) => same(x, m.label))) next.rejected.push(m.label);
    return { round: next, ok: true, yes: false, intent: intent.intent, reply: "Thanks, not that one. Let me adjust." };
  }

  return { round: next, ok: true, intent: intent.intent };
}

const uncountable = /^(traffic|wind|rain|music|grass|cooking|hair|coffee|fuel|soap|my breathing|old paper|footsteps|voices|birds|books|hands|clothes|keys|curtains|silence)$/;
export function guessText(label: string, sense: SenseKey) {
  const articleValue = uncountable.test(label) || label.endsWith("s") ? "" : /^[aeiou]/.test(label) ? "an " : "a ";
  const lead = sense === "hear" || sense === "smell" ? "" : "";
  return `Is it ${lead}${articleValue}${label}?`;
}

export function describeMove(m: Move, r: Round): string {
  switch (m.kind) {
    case "setting":
      return pickOne(["Set the scene for me: where are you?", "Where are you right now? Quick scene check."]);
    case "posture":
      return pickOne(["Body clue: lying, sitting, or standing?", "Posture check — lying, sitting, or standing?"]);
    case "ask":
      return m.text;
    case "guess":
      return pickOne([`I think I’ve got it: ${guessText(m.label, r.sense)}`, `Okay, locking in a guess… ${guessText(m.label, r.sense)}`]);
    case "reveal":
      return "You got me. What was it?";
    default:
      return "Hmm.";
  }
}

export function reaction(m: Move, res: { ok: boolean; yes?: boolean; intent?: UnderstandIntent; reply?: string }, r: Round): string {
  if (res.reply) return res.reply;
  if (m.kind === "setting") {
    const settingName = r.setting && r.setting !== "other" ? SETTINGS.find((s) => s.id === r.setting)?.name.toLowerCase() : null;
    return settingName ? pickOne([`A ${settingName}. Nice, I can picture it.`, `Great, ${settingName}. That helps a lot.`]) : "Thanks, I can work with that.";
  }
  if (m.kind === "posture") return pickOne(["Nice, got it.", "Perfect, thanks."]);
  if (m.kind === "ask") {
    if (!res.ok) return pickOne(["I might have missed that — one more hint?", "Could you say that a different way for me?"]);
    if (res.yes) return pickOne(["Great clue.", "That narrows it down."]);
    return pickOne(["Good, ruling that out.", "Nice, that helps me cut options."]);
  }
  if (m.kind === "guess") return "Thanks. Let me rethink it.";
  return "";
}

export const article = (label: string) => (uncountable.test(label) || label.endsWith("s") ? "" : /^[aeiou]/.test(label) ? "an " : "a ");
