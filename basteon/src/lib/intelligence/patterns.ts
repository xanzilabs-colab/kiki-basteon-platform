import { createHash } from "node:crypto";

export type TravelMode = "taxi" | "walk";
export type PatternSample = {
  durationSeconds: number;
  completedAt: string;
};
export type PatternStats = {
  sampleCount: number;
  durationP50: number;
  durationP80: number;
  durationP95: number;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  durationsSeconds: number[];
};

function roundedCluster(point: { lat: number; lng: number }) {
  return `${Math.round(point.lat / 0.005)}:${Math.round(point.lng / 0.005)}`;
}

export function buildTripPatternKey(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const clusterPair = `${roundedCluster(origin)}>${roundedCluster(destination)}`;
  return createHash("sha256").update(clusterPair).digest("hex");
}

export function getPatternTime(input: Date) {
  const day = input.getUTCDay();
  return {
    dayType: day === 0 || day === 6 ? "weekend" as const : "weekday" as const,
    timeBucket: Math.floor(input.getUTCHours() / 2),
  };
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function buildPatternStats(samples: PatternSample[], now = new Date(), maxSamples = 30): PatternStats | null {
  const cutoff = now.getTime() - 90 * 24 * 60 * 60_000;
  const valid = samples
    .filter((sample) => Number.isFinite(sample.durationSeconds) && sample.durationSeconds >= 0 && new Date(sample.completedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, maxSamples);
  if (!valid.length) return null;
  const durations = valid.map((sample) => Math.round(sample.durationSeconds)).sort((a, b) => a - b);
  const arrivalMinutes = valid.map((sample) => {
    const date = new Date(sample.completedAt);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }).sort((a, b) => a - b);
  const p05 = percentile(arrivalMinutes, 0.05);
  const p95 = percentile(arrivalMinutes, 0.95);
  const dateForMinute = (minute: number) => {
    const date = new Date(valid[0].completedAt);
    date.setUTCHours(Math.floor(minute / 60), minute % 60, 0, 0);
    return date.toISOString();
  };
  return {
    sampleCount: durations.length,
    durationP50: percentile(durations, 0.5),
    durationP80: percentile(durations, 0.8),
    durationP95: percentile(durations, 0.95),
    arrivalWindowStart: dateForMinute(p05),
    arrivalWindowEnd: dateForMinute(p95),
    durationsSeconds: durations,
  };
}

export function blendExpectedDuration(routeSeconds: number, learned: Pick<PatternStats, "sampleCount" | "durationP50" | "durationP80"> | null) {
  if (!Number.isFinite(routeSeconds) || routeSeconds < 0) throw new Error("Routing duration must be non-negative.");
  if (!learned || learned.sampleCount < 3) {
    return {
      durationSeconds: Math.round(routeSeconds),
      confidence: learned ? Math.min(0.35, learned.sampleCount / 10) : 0,
      reason: learned
        ? `We're still learning this route (${learned.sampleCount} similar completed ${learned.sampleCount === 1 ? "trip" : "trips"}); using the route estimate.`
        : "We're still learning your usual routes; using the route estimate.",
    };
  }
  const weight = Math.min(0.75, learned.sampleCount / (learned.sampleCount + 6));
  const durationSeconds = Math.round(routeSeconds * (1 - weight) + learned.durationP80 * weight);
  const p50Minutes = Math.max(1, Math.round(learned.durationP50 / 60));
  const p80Minutes = Math.max(p50Minutes, Math.round(learned.durationP80 / 60));
  return {
    durationSeconds,
    confidence: Math.min(0.95, 0.35 + learned.sampleCount / 40),
    reason: `Based on ${learned.sampleCount} similar completed trips; they usually take ${p50Minutes}–${p80Minutes} minutes. The estimate blends that pattern with the current route.`,
  };
}
