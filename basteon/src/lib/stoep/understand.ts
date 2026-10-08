import { DESCRIPTORS, OBJECTS, SETTINGS, SYNONYMS, type Descriptor } from "./knowledge";

export type UnderstandIntent =
  | "YES"
  | "NO"
  | "UNSURE"
  | "PARTIAL"
  | "CHOICE"
  | "DIRECT_ANSWER"
  | "DESCRIPTOR"
  | "CHALLENGE"
  | "CORRECTION"
  | "META"
  | "FRUSTRATION"
  | "DISTRESS";

export type UnderstandContext = {
  options?: [string, string];
  sense?: string;
  rejected?: string[];
};

export type UnderstandResult = {
  intent: UnderstandIntent;
  confidence: number;
  entities: {
    object?: string;
    descriptors: Descriptor[];
    choice?: string;
    ambiguousChoices?: string[];
    colors: string[];
    yesNo?: "yes" | "no" | "maybe";
  };
};

const strip = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const singular = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

export function normalize(text: string) {
  const lowered = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9'\s]/g, " ");
  const collapsedLetters = lowered.replace(/([a-z])\1{2,}/g, "$1$1");
  return collapsedLetters.replace(/\s+/g, " ").trim();
}

function words(text: string) {
  return normalize(text).split(" ").filter(Boolean).map(singular);
}

function lev(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function jaro(s1: string, s2: string) {
  if (s1 === s2) return 1;
  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const matches1 = new Array<boolean>(s1.length).fill(false);
  const matches2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (matches2[j] || s1[i] !== s2[j]) continue;
      matches1[i] = true;
      matches2[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  return (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;
}

function jaroWinkler(a: string, b: string) {
  const j = jaro(a, b);
  const prefix = (() => {
    let n = 0;
    for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
      if (a[i] !== b[i]) break;
      n++;
    }
    return n;
  })();
  return j + prefix * 0.1 * (1 - j);
}

function fuzzyScore(a: string, b: string) {
  const x = strip(a);
  const y = strip(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)) return 0.94;
  const jw = jaroWinkler(x, y);
  const ld = lev(x, y);
  const len = Math.max(x.length, y.length);
  const levScore = 1 - ld / Math.max(1, len);
  return Math.max(jw, levScore * 0.96);
}

const YES = ["yes", "yup", "yep", "yeah", "yea", "sure", "correct", "exactly", "definitely", "absolutely", "you got it", "that one", "that's it", "it is", "true", "right"];
const NO = ["no", "nope", "nah", "nahh", "neither", "none", "nothing like that", "not at all", "no way", "wrong", "incorrect", "that's wrong", "nah fam", "yeah nah"];
const UNSURE = ["idk", "i dont know", "not sure", "unsure", "maybe", "perhaps", "hard to say", "dunno"];
const PARTIAL = ["kind of", "kinda", "sort of", "a bit", "maybe yes", "not really", "sometimes"];

const DESCRIPTOR_SYNONYMS: Record<Descriptor, string[]> = {
  fruity: ["fruit", "orange", "banana", "guava", "juicy", "citrus"],
  sweet: ["sugary", "dessert", "candy", "honey"],
  sour: ["acidic", "tart"],
  floral: ["flower", "perfume"],
  smoky: ["smoke", "char", "braai"],
  musty: ["old", "damp", "stale"],
  soapy: ["soap", "detergent", "cleaner", "handy andy", "sunlight"],
  spicy: ["spice", "chilli", "peppery"],
  minty: ["mint", "toothpaste", "gum"],
  burnt: ["burn", "toasted", "charred"],
  fresh: ["clean", "new", "airy"],
  earthy: ["soil", "dirt", "ground", "wet earth"],
  sharp: ["strong", "pungent", "stingy"],
  warm: ["hot", "heated"],
  cold: ["cool", "chilly", "icy"],
  loud: ["noisy"],
  quiet: ["silent", "silence"],
  rhythmic: ["beat", "pattern", "steady pulse"],
  "high-pitched": ["high pitch", "shrill", "piercing"],
  deep: ["low", "bass", "rumble"],
  rough: ["coarse", "grainy"],
  smooth: ["silky", "sleek"],
  soft: ["fluffy", "squishy"],
};

const DISTRESS = /(kill myself|suicid|end my life|want to die|hurt myself|self.?harm|in danger|not safe|being followed|abused|attacked)/i;

function lexiconMatch(input: string, lexicon: string[]) {
  let best = 0;
  for (const word of lexicon) best = Math.max(best, fuzzyScore(input, word));
  return best;
}

function extractDescriptors(input: string) {
  const tokens = words(input).join(" ");
  const out: Descriptor[] = [];
  for (const descriptor of DESCRIPTORS) {
    const synonyms = [descriptor, ...(DESCRIPTOR_SYNONYMS[descriptor] ?? [])];
    if (synonyms.some((entry) => fuzzyScore(tokens, entry) >= 0.83 || ` ${tokens} `.includes(` ${entry} `))) out.push(descriptor);
  }
  return [...new Set(out)];
}

function objectCandidates(input: string, rejected: string[] = []) {
  const cleaned = strip(input);
  const ranked: { label: string; score: number }[] = [];
  for (const object of OBJECTS) {
    if (rejected.some((x) => x.toLowerCase() === object.label.toLowerCase())) continue;
    const names = [object.label, ...object.alias].map((name) => SYNONYMS[name] ?? name);
    let best = 0;
    for (const candidate of names) best = Math.max(best, fuzzyScore(cleaned, candidate));
    if (best >= 0.68) ranked.push({ label: object.label, score: best });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

function isChallenge(input: string) {
  const n = normalize(input);
  if (!n) return false;
  if (n.includes("?")) return true;
  return /^(how|why|what|but|that's|thats|really)/.test(n);
}

export function classify(text: string, ctx: UnderstandContext = {}): UnderstandResult {
  const n = normalize(text);
  const cleaned = strip(n);
  const descriptorHits = extractDescriptors(n);
  const colors = ["green", "blue", "brown", "white", "black"].filter((color) => ` ${cleaned} `.includes(` ${color} `));

  if (DISTRESS.test(text)) return { intent: "DISTRESS", confidence: 0.99, entities: { descriptors: descriptorHits, colors } };
  if (/^(repeat|again|what\??|huh|skip|next question)/.test(n)) return { intent: "META", confidence: 0.88, entities: { descriptors: descriptorHits, colors } };
  if (/(you're bad|you are bad|you suck|just guess|i already told you|read properly|listen)/.test(n)) {
    return { intent: "FRUSTRATION", confidence: 0.9, entities: { descriptors: descriptorHits, colors } };
  }
  if (/(no i said|i said|that's wrong|thats wrong|you heard me wrong)/.test(n)) return { intent: "CORRECTION", confidence: 0.9, entities: { descriptors: descriptorHits, colors } };

  if (ctx.options) {
    const [a, b] = ctx.options;
    const aScore = fuzzyScore(cleaned, a);
    const bScore = fuzzyScore(cleaned, b);
    const neither = /(neither|none|both wrong|not either)/.test(n);
    if (neither) return { intent: "CHOICE", confidence: 0.94, entities: { descriptors: descriptorHits, colors, choice: "neither", ambiguousChoices: [a, b] } };
    if (aScore >= 0.8 || bScore >= 0.8) {
      return { intent: "CHOICE", confidence: Math.max(aScore, bScore), entities: { descriptors: descriptorHits, colors, choice: aScore >= bScore ? a : b } };
    }
  }

  const yesScore = lexiconMatch(cleaned, YES);
  const noScore = Math.max(lexiconMatch(cleaned, NO), /(not|never|no)\b/.test(n) ? 0.84 : 0);
  const unsureScore = lexiconMatch(cleaned, UNSURE);
  const partialScore = lexiconMatch(cleaned, PARTIAL);

  if (isChallenge(text)) {
    return { intent: "CHALLENGE", confidence: 0.86, entities: { descriptors: descriptorHits, colors, yesNo: noScore > yesScore ? "no" : "maybe" } };
  }

  const objectMatches = objectCandidates(cleaned, ctx.rejected);
  if (objectMatches.length > 0 && objectMatches[0].score >= 0.85) {
    const top = objectMatches[0];
    const second = objectMatches[1];
    if (second && Math.abs(top.score - second.score) < 0.04) {
      return {
        intent: "CHOICE",
        confidence: top.score,
        entities: {
          descriptors: descriptorHits,
          colors,
          ambiguousChoices: [top.label, second.label],
        },
      };
    }
    const onlyDescriptorWord = DESCRIPTORS.includes(top.label as Descriptor) || ["green", "blue", "brown", "white", "black"].includes(top.label);
    if (!onlyDescriptorWord) return { intent: "DIRECT_ANSWER", confidence: top.score, entities: { object: top.label, descriptors: descriptorHits, colors } };
  }

  if (descriptorHits.length > 0 || colors.length > 0) return { intent: "DESCRIPTOR", confidence: 0.86, entities: { descriptors: descriptorHits, colors } };
  if (partialScore >= 0.82) return { intent: "PARTIAL", confidence: partialScore, entities: { descriptors: descriptorHits, colors, yesNo: "maybe" } };
  if (noScore >= 0.82 && noScore >= yesScore) return { intent: "NO", confidence: noScore, entities: { descriptors: descriptorHits, colors, yesNo: "no" } };
  if (yesScore >= 0.82) return { intent: "YES", confidence: yesScore, entities: { descriptors: descriptorHits, colors, yesNo: "yes" } };
  if (unsureScore >= 0.8) return { intent: "UNSURE", confidence: unsureScore, entities: { descriptors: descriptorHits, colors, yesNo: "maybe" } };

  const settingWord = SETTINGS.find((setting) => setting.words.some((word) => fuzzyScore(cleaned, word) >= 0.87));
  if (settingWord) return { intent: "DESCRIPTOR", confidence: 0.7, entities: { descriptors: descriptorHits, colors } };

  if (cleaned.length > 1) return { intent: "DESCRIPTOR", confidence: 0.55, entities: { descriptors: descriptorHits, colors } };
  return { intent: "UNSURE", confidence: 0.4, entities: { descriptors: descriptorHits, colors, yesNo: "maybe" } };
}
