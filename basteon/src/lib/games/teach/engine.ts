export const LIMITS = { problem: 120, tip: 400, example: 240, checkQ: 140, option: 80 } as const;
export const PROMOTE = { distinctHelpful: 5, maxOpenReports: 0 } as const;
export const XP = { helpful: 20, try: 12, notForMe: 4, quizRight: 15, authored: 10 } as const;

export interface CardInput {
  problem: string;
  tip: string;
  example?: string;
  checkQ: string;
  checkOptions: string[];
  checkAnswer: number;
}

export interface Findings {
  pii: string[];
  risk: string[];
  selfHarm: boolean;
}

const PII_PATTERNS: [string, RegExp][] = [
  ["phone number", /(?:\+?27|0)[\s-]?[1-9][\d\s-]{7,11}/],
  ["email address", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
  ["web link", /(?:https?:\/\/|www\.)\S+/i],
  ["ID number", /\b\d{13}\b/],
  ["street address", /\b\d{1,5}\s+[a-z]+(?:\s+[a-z]+)?\s+(?:street|st|road|rd|avenue|ave|drive|dr|crescent|cres|lane)\b/i],
  ["social handle", /(?:^|\s)@[a-z0-9_.]{3,}/i],
];

const RISK_PATTERNS: Record<string, RegExp[]> = {
  medical: [
    /\b(?:dose|dosage|medication|prescription|diagnose|diagnosis|diagnosed|diagnosing|cure)\b/,
    /\bstop\s+taking\b/,
  ],
  legal: [
    /\b(?:sue|sues|sued|suing|lawsuit)\b/,
    /\bcourt\s+order\b/,
    /\byou\s+must\s+legally\b/,
    /\bit\s+is\s+illegal\b/,
    /\blegal\s+advice\b/,
  ],
  safety: [
    /\bconfront\s+(?:him|her|them)\b/,
    /\bdon['’]?t\s+(?:call|contact)\s+the\s+police\b/,
    /\bdon['’]?t\s+report\b/,
    /\bcarry\s+a\s+weapon\b/,
    /\bfight\s+back\b/,
    /\b(?:hurt|harm)\s+(?:yourself|someone|them|him|her)\b/,
  ],
  financial: [
    /\bguaranteed\s+returns?\b/,
    /\bloan\s+shark\b/,
    /\bget\s+rich\b/,
    /\bcrypto(?:currency)?\b/,
    /\binvest\s+all\b/,
  ],
};

const SELF_HARM = ["suicide", "kill myself", "end my life", "self-harm", "self harm", "cut myself", "want to die"];

export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

export function scanText(text: string): Findings {
  const t = normalizeText(text);
  const lower = " " + t.toLowerCase() + " ";
  const pii = PII_PATTERNS.filter(([, re]) => re.test(t)).map(([name]) => name);
  const risk = Object.entries(RISK_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(lower)))
    .map(([k]) => k);
  const selfHarm = SELF_HARM.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
  return { pii, risk, selfHarm };
}

export type CardVerdict =
  | { ok: true }
  | { ok: false; code: "invalid"; fields: string[] }
  | { ok: false; code: "pii"; findings: string[] }
  | { ok: false; code: "self_harm" }
  | { ok: false; code: "professional"; categories: string[] };

export function validateCard(c: CardInput, opts: { verified: boolean }): CardVerdict {
  const fields: string[] = [];
  const t = (s: string | undefined) => normalizeText(s ?? "");
  if (!t(c.problem) || t(c.problem).length > LIMITS.problem) fields.push("problem");
  if (t(c.tip).length < 15 || t(c.tip).length > LIMITS.tip) fields.push("tip");
  if (c.example && t(c.example).length > LIMITS.example) fields.push("example");
  if (!t(c.checkQ) || t(c.checkQ).length > LIMITS.checkQ) fields.push("checkQ");
  if (c.checkOptions.length !== 3 || c.checkOptions.some((o) => !t(o) || t(o).length > LIMITS.option) || new Set(c.checkOptions.map((o) => t(o).toLowerCase())).size !== 3)
    fields.push("checkOptions");
  if (!Number.isInteger(c.checkAnswer) || c.checkAnswer < 0 || c.checkAnswer > 2) fields.push("checkAnswer");
  if (fields.length) return { ok: false, code: "invalid", fields };

  const all = [c.problem, c.tip, c.example ?? "", c.checkQ, ...c.checkOptions].join(" \n ");
  const findings = scanText(all);
  if (findings.selfHarm) return { ok: false, code: "self_harm" };
  if (findings.pii.length) return { ok: false, code: "pii", findings: findings.pii };
  if (!opts.verified && findings.risk.length) return { ok: false, code: "professional", categories: findings.risk };
  return { ok: true };
}

export type Rating = "helpful" | "try" | "not_for_me";

export function ratingXp(r: Rating): number {
  return r === "helpful" ? XP.helpful : r === "try" ? XP.try : XP.notForMe;
}

export function sessionScores(args: {
  ratingsOnMyCards: Rating[];
  myQuizResults: boolean[];
  cardsAuthored: number;
}) {
  const teacher = args.ratingsOnMyCards.reduce((a, r) => a + ratingXp(r), 0) + args.cardsAuthored * XP.authored;
  const learner = args.myQuizResults.filter(Boolean).length * XP.quizRight;
  return { teacher, learner };
}

export function promotionEligible(c: { tier: string; distinctHelpful: number; openReports: number; flagged: boolean }): boolean {
  if (c.tier !== "community" || c.flagged) return false;
  return c.distinctHelpful >= PROMOTE.distinctHelpful && c.openReports <= PROMOTE.maxOpenReports;
}

/** Shuffle the 3 options for the reader; returns options and the new index of the correct one. */
export function shuffledOptions(options: string[], answer: number, seed: number): { options: string[]; answer: number } {
  const idx = [0, 1, 2];
  let s = seed >>> 0;
  for (let i = 2; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { options: idx.map((i) => options[i]), answer: idx.indexOf(answer) };
}

export const BADGES = [
  { id: "first_tip", test: (p: { cards: number }) => p.cards >= 1 },
  { id: "helper_5", test: (p: { helpful: number }) => p.helpful >= 5 },
  { id: "helper_25", test: (p: { helpful: number }) => p.helpful >= 25 },
] as const;
