import { CONFIG, LETTERS, buildSpec, rolesForRound, solutions } from "./engine";
import type { Mode, RoundSpec, Rng, WordIndex } from "./engine";

export type Difficulty = "easy" | "medium" | "hard";

const PROFILE = {
  easy: { failRate: 0.35, minMs: 3000, maxMs: 4600, bias: -1 },
  medium: { failRate: 0.15, minMs: 1800, maxMs: 3800, bias: 0 },
  hard: { failRate: 0.05, minMs: 900, maxMs: 2400, bias: 1 },
} as const;

const START_ORDER = "scpbtmadrfgheilonwukvjyzqx";
const END_ORDER = "esdtyrnlgkamhoicpbfwuvzxjq";

function weightedPick(order: string, rng: Rng): string {
  let r = rng() * ((order.length * (order.length + 1)) / 2);
  for (let i = 0; i < order.length; i++) {
    r -= order.length - i;
    if (r <= 0) return order[i];
  }
  return order[order.length - 1];
}

export function botLetter(role: "start" | "end", rng: Rng): string {
  return weightedPick(role === "start" ? START_ORDER : END_ORDER, rng);
}

export const autoPickLetter = botLetter;

export function buildBotRoundPick(args: {
  round: number;
  mode: Mode;
  playerId: string;
  botId: string;
  carryStart?: string;
  letter: string;
  idx: WordIndex;
  used: Set<string>;
  rng: Rng;
}): { spec: RoundSpec; picks: Record<string, string> } | null {
  const roles = rolesForRound(args.round, args.playerId, args.botId);
  const chainCarries = args.mode === "chain" && args.round > 1 && Boolean(args.carryStart);
  const humanPicker = chainCarries
    ? roles.endPicker
    : roles.startPicker === args.playerId ? roles.startPicker : roles.endPicker;
  if (humanPicker !== args.playerId) return null;

  const picks: Record<string, string> = {};
  if (chainCarries && args.carryStart) picks.carryStart = args.carryStart;
  if (!chainCarries) {
    const botPicker = humanPicker === roles.startPicker ? roles.endPicker : roles.startPicker;
    const botRole = botPicker === roles.startPicker ? "start" : "end";
    picks[botPicker] = botLetter(botRole, args.rng);
  }
  picks[humanPicker] = args.letter.toLowerCase();

  const spec = buildSpec({
    round: args.round,
    mode: args.mode,
    start: chainCarries ? args.carryStart! : picks[roles.startPicker],
    end: picks[roles.endPicker] ?? botLetter("end", args.rng),
    preserveStart: chainCarries || humanPicker === roles.startPicker,
    preserveEnd: humanPicker === roles.endPicker,
    idx: args.idx,
    used: args.used,
    rng: args.rng,
  });

  return {
    spec,
    picks: {
      ...picks,
      ...(chainCarries ? { carryStart: args.carryStart! } : {}),
      start: spec.start,
      end: spec.end,
    },
  };
}

export interface BotAnswer {
  word: string | null;
  delayMs: number;
  kind: "correct" | "miss" | "timeout";
}

export function botAnswer(
  idx: WordIndex,
  spec: RoundSpec,
  used: Set<string>,
  diff: Difficulty,
  rng: Rng,
  blocked: Set<string> = new Set(),
): BotAnswer {
  const profile = PROFILE[diff];
  let delayMs = Math.round(profile.minMs + rng() * (profile.maxMs - profile.minMs));
  const candidates = solutions(idx, spec, used).filter((word) => !blocked.has(word));
  if (candidates.length < 15) delayMs += Math.round(rng() * 900);

  if (candidates.length === 0 || rng() < profile.failRate) {
    if (rng() < 0.5) {
      const otherEnds = LETTERS.filter((letter) => letter !== spec.end);
      const end = otherEnds[Math.floor(rng() * otherEnds.length)];
      const nearMisses = idx.get(spec.start + end) ?? [];
      if (nearMisses.length) {
        return { word: nearMisses[Math.floor(rng() * nearMisses.length)], delayMs, kind: "miss" };
      }
    }
    return { word: null, delayMs: CONFIG.answerMs + 1000, kind: "timeout" };
  }

  const sorted = [...candidates].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const cut = Math.max(1, Math.ceil(sorted.length * 0.4));
  const pool = profile.bias < 0 ? sorted.slice(0, cut) : profile.bias > 0 ? sorted.slice(-cut) : sorted;
  return { word: pool[Math.floor(rng() * pool.length)], delayMs, kind: "correct" };
}

export const BOT_LINES = {
  thinking: ["Hmm... give me a sec", "Ooh, tricky one!", "Let me think..."],
  correct: ["Got it!", "Easy!", "Boom."],
  miss: ["Oops, wrong one!", "My brain froze!", "Argh!"],
  win: ["Good game! Rematch?", "That was fun!"],
  lose: ["You got me!", "Nicely played!"],
} as const;
