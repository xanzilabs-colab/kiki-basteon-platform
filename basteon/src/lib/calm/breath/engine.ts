export type PhaseKind = "inhale" | "hold" | "topup" | "exhale";
export interface Phase { kind: PhaseKind; ms: number; from: number; to: number }
export interface Pattern { id: string; title: string; blurb: string; cycles: number; optionalHolds: boolean; phases: Phase[] }

export const PATTERNS: Record<string, Pattern> = {
  box: {
    id: "box", title: "Box breathing", blurb: "In, hold, out, hold. Even and steady.", cycles: 5, optionalHolds: true,
    phases: [
      { kind: "inhale", ms: 4000, from: 0.35, to: 1 },
      { kind: "hold", ms: 4000, from: 1, to: 1 },
      { kind: "exhale", ms: 4000, from: 1, to: 0.35 },
      { kind: "hold", ms: 4000, from: 0.35, to: 0.35 },
    ],
  },
  sigh: {
    id: "sigh", title: "Calming sigh", blurb: "Two sips in through the nose, one long breath out.", cycles: 6, optionalHolds: false,
    phases: [
      { kind: "inhale", ms: 3000, from: 0.35, to: 0.85 },
      { kind: "topup", ms: 1200, from: 0.85, to: 1 },
      { kind: "exhale", ms: 6500, from: 1, to: 0.35 },
    ],
  },
  slow: {
    id: "slow", title: "Long exhale", blurb: "Breathe in for 4, out for 6.", cycles: 6, optionalHolds: false,
    phases: [
      { kind: "inhale", ms: 4000, from: 0.35, to: 1 },
      { kind: "exhale", ms: 6000, from: 1, to: 0.35 },
    ],
  },
};

export type Pace = "gentle" | "standard";
export const PACE_SCALE: Record<Pace, number> = { gentle: 1.25, standard: 1 };

export function effectivePhases(p: Pattern, holds: boolean, pace: Pace): Phase[] {
  const k = PACE_SCALE[pace];
  return p.phases.filter((ph) => holds || ph.kind !== "hold").map((ph) => ({ ...ph, ms: Math.round(ph.ms * k) }));
}

export const cycleMs = (phases: Phase[]) => phases.reduce((a, p) => a + p.ms, 0);
export const totalMs = (phases: Phase[], cycles: number) => cycleMs(phases) * cycles;

export interface Tick {
  done: boolean; cycle: number; phaseIndex: number; kind: PhaseKind;
  progress: number; msLeftInPhase: number; elapsedMs: number; size: number;
}

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

export function tickAt(phases: Phase[], cycles: number, elapsedMs: number): Tick {
  const total = totalMs(phases, cycles);
  if (elapsedMs >= total) {
    const last = phases[phases.length - 1];
    return { done: true, cycle: cycles, phaseIndex: phases.length - 1, kind: last.kind, progress: 1, msLeftInPhase: 0, elapsedMs: total, size: last.to };
  }
  const cm = cycleMs(phases);
  const cycle = Math.floor(elapsedMs / cm);
  let t = elapsedMs - cycle * cm;
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    if (t < ph.ms) {
      const progress = t / ph.ms;
      return { done: false, cycle, phaseIndex: i, kind: ph.kind, progress, msLeftInPhase: ph.ms - t, elapsedMs, size: ph.from + (ph.to - ph.from) * ease(progress) };
    }
    t -= ph.ms;
  }
  const last = phases[phases.length - 1];
  return { done: false, cycle, phaseIndex: phases.length - 1, kind: last.kind, progress: 1, msLeftInPhase: 0, elapsedMs, size: last.to };
}

export const PHASE_LABEL: Record<PhaseKind, string> = { inhale: "Breathe in", hold: "Hold gently", topup: "A little more", exhale: "Breathe out" };

export function questionPhaseIndex(phases: Phase[]): number {
  const hold = phases.findIndex((p) => p.kind === "hold");
  if (hold >= 0) return hold;
  let idx = 0;
  phases.forEach((p, i) => { if (p.kind === "inhale" || p.kind === "topup") idx = i; });
  return idx;
}

export function answerPhaseIndex(phases: Phase[]): number {
  const q = questionPhaseIndex(phases);
  const e = phases.findIndex((p, i) => i > q && p.kind === "exhale");
  return e >= 0 ? e : phases.findIndex((p) => p.kind === "exhale");
}

export function hapticPattern(kind: PhaseKind, ms: number): number[] {
  if (kind === "hold") return [];
  if (kind === "topup") return [35, 70, 35];
  const step = 420;
  const n = Math.max(2, Math.floor(ms / step));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 1 : i / (n - 1);
    const on = Math.round(kind === "inhale" ? 14 + 34 * f : 48 - 34 * f);
    out.push(on, step - on);
  }
  return out;
}

export type Mulberry = () => number;
export function pickTrivia<T extends { id: string }>(all: T[], seen: Set<string>, n: number, rng: Mulberry): T[] {
  const fresh = all.filter((t) => !seen.has(t.id));
  const pool = fresh.length >= n ? fresh : all;
  return [...pool].sort(() => rng() - 0.5).slice(0, n);
}
