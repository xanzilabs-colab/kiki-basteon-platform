export type Action = "sos" | "medical" | "duress" | "cancel";
export interface Sample { prompted: number; sig: string; presses: number; gaps: number[] }
export interface GestureStat {
  sig: string;
  taps: number;
  samples: number;
  total: number;
  reliability: number;
  p95Gap: number;
  risk: number;
  grade: "A" | "B" | "C";
  notes: string[];
}
export interface Analysis {
  gestures: GestureStat[];
  indistinguishable: { sig: string; taps: number[] }[];
  unseen: number[];
  timing: { gapMs: number; settleMs: number };
}

const RISK_BY_TAPS = [0.95, 0.95, 0.6, 0.35, 0.2, 0.15, 0.1];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

export function riskFor(signature: string, taps: number): number {
  let risk = RISK_BY_TAPS[Math.min(Math.max(0, taps), RISK_BY_TAPS.length - 1)];
  if (/[UD]/.test(signature)) risk += 0.15;
  if (/H/.test(signature)) risk += 0.1;
  return clamp(risk, 0, 1);
}

export function analyze(samples: Sample[]): Analysis {
  const byPrompt = new Map<number, Sample[]>();
  const allGaps: number[] = [];
  for (const sample of samples) {
    if (!Number.isInteger(sample.prompted) || sample.prompted < 1 || sample.prompted > 6) continue;
    byPrompt.set(sample.prompted, [...(byPrompt.get(sample.prompted) ?? []), sample]);
  }

  const unseen: number[] = [];
  const candidates: GestureStat[] = [];
  for (const [taps, group] of byPrompt) {
    const seen = group.filter(({ sig }) => sig.length > 0);
    if (!seen.length) {
      unseen.push(taps);
      continue;
    }
    const counts = new Map<string, number>();
    seen.forEach(({ sig }) => counts.set(sig, (counts.get(sig) ?? 0) + 1));
    const [signature, sampleCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const matching = group.filter(({ sig }) => sig === signature);
    const gaps = matching.flatMap(({ gaps: values }) => values.filter((value) => Number.isFinite(value) && value >= 0));
    allGaps.push(...gaps);
    const reliability = sampleCount / group.length;
    const risk = riskFor(signature, taps);
    const notes: string[] = [];
    if (counts.size > 1) notes.push("Sometimes produced a different signal.");
    if (/[UD]/.test(signature)) notes.push("Changes your volume and may not work at maximum or minimum volume.");
    if (taps <= 2) notes.push("Easy to trigger by accident while listening to music.");
    if (signature.includes("-")) notes.push("Needs steady speed (the taps were split into groups).");
    const grade: GestureStat["grade"] =
      /[UD]/.test(signature) ? "C"
        : reliability >= 0.99 && group.length >= 3 && risk <= 0.4 ? "A"
        : reliability >= 0.66 && risk <= 0.65 ? "B" : "C";
    candidates.push({
      sig: signature,
      taps,
      samples: sampleCount,
      total: group.length,
      reliability,
      p95Gap: percentile(gaps, 0.95),
      risk,
      grade,
      notes,
    });
  }

  const bySignature = new Map<string, GestureStat[]>();
  candidates.forEach((gesture) => bySignature.set(gesture.sig, [...(bySignature.get(gesture.sig) ?? []), gesture]));
  const indistinguishable: Analysis["indistinguishable"] = [];
  const gestures: GestureStat[] = [];
  for (const [sig, group] of bySignature) {
    if (group.length === 1) {
      gestures.push(group[0]);
      continue;
    }
    indistinguishable.push({ sig, taps: group.map(({ taps }) => taps).sort((a, b) => a - b) });
    const first = [...group].sort((a, b) => a.taps - b.taps)[0];
    gestures.push({ ...first, grade: "C", notes: [...first.notes, "The same signal appears for different tap counts."] });
  }
  gestures.sort((a, b) => a.taps - b.taps);
  const gapMs = clamp(Math.round(percentile(allGaps, 0.95) * 1.35) || 650, 350, 900);
  return { gestures, indistinguishable, unseen: unseen.sort((a, b) => a - b), timing: { gapMs, settleMs: gapMs + 250 } };
}

const usable = (gesture: GestureStat) => gesture.grade !== "C";

export function recommend(gestures: GestureStat[]): Partial<Record<Action, string>> {
  const used = new Set<string>();
  const output: Partial<Record<Action, string>> = {};
  const take = (action: Action, pool: GestureStat[], score: (gesture: GestureStat) => number) => {
    const candidate = pool
      .filter(({ sig }) => !used.has(sig))
      .sort((a, b) => score(a) - score(b) || b.reliability - a.reliability)[0];
    if (candidate) {
      output[action] = candidate.sig;
      used.add(candidate.sig);
    }
  };
  const alerts = gestures.filter((gesture) => usable(gesture) && gesture.risk <= 0.65);
  take("sos", alerts, ({ taps }) => Math.abs(taps - 3));
  take("medical", alerts, ({ taps }) => Math.abs(taps - 4));
  take("duress", alerts, ({ taps }) => Math.abs(taps - 5));
  take("cancel", gestures.filter(usable), ({ taps }) => taps);
  return output;
}

export function validateMapping(mapping: Partial<Record<Action, string>>, gestures: GestureStat[]): string[] {
  const errors: string[] = [];
  const assigned = new Map<string, Action>();
  for (const [action, signature] of Object.entries(mapping) as [Action, string][]) {
    if (!gestures.some(({ sig }) => sig === signature)) errors.push(`${action}: that gesture was not detected during testing.`);
    const previous = assigned.get(signature);
    if (previous) errors.push(`${action} and ${previous} use the same gesture.`);
    assigned.set(signature, action);
  }
  return errors;
}

export function profileTrust(
  gestures: GestureStat[],
  mapping: Partial<Record<Action, string>>,
  verified: boolean,
) {
  if (!mapping.sos || !mapping.cancel) return "incomplete" as const;
  const grades = Object.values(mapping).map((signature) =>
    gestures.find(({ sig }) => sig === signature)?.grade ?? "C"
  );
  const worst = grades.sort().pop();
  return verified && worst !== "C" ? "ready" as const : verified ? "verified_with_warnings" as const : "unverified" as const;
}
