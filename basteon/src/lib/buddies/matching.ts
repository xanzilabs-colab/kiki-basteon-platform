import { BUDDY_CONFIG as C, type OverlapProfile } from "./config";
import { angleDiffDeg, bearingDeg, haversineM, nearestOnPolyline, polylineLengthM, resample, snapToCell } from "./geo";
import { inAnyZone } from "./privacy";
import type { AreaInfo, AreaResolver, BuddyPresence, LatLng } from "./types";

/** Default area resolver: coarse grid cell, no label. Swap in a reverse-geocoder for suburb/ward names. */
export const cellAreaResolver: AreaResolver = (p): AreaInfo => ({
  id: snapToCell(p, C.areaCellSizeM).id,
  label: null,
});

export function timeOverlapMin(a: BuddyPresence, b: BuddyPresence): number {
  return (Math.min(a.leaveTo, b.leaveTo) - Math.max(a.leaveFrom, b.leaveFrom)) / 60_000;
}

/** Same-direction overlap of two routes, measured on the shorter one. Inputs are zone-trimmed runs. */
export function routeOverlap(aRuns: LatLng[][], bRuns: LatLng[][], p: OverlapProfile) {
  const len = (runs: LatLng[][]) => runs.reduce((s, r) => s + polylineLengthM(r), 0);
  const [short, long] = len(aRuns) <= len(bRuns) ? [aRuns, bRuns] : [bRuns, aRuns];
  let total = 0;
  let matched = 0;
  for (const run of short) {
    const pts = resample(run, p.sampleM);
    for (let i = 0; i < pts.length - 1; i++) {
      total++;
      const brg = bearingDeg(pts[i], pts[i + 1]);
      for (const lr of long) {
        if (lr.length < 2) continue;
        const n = nearestOnPolyline(pts[i], lr);
        if (n.distM <= p.corridorM && angleDiffDeg(n.bearing, brg) <= p.maxBearingDiffDeg) {
          matched++;
          break;
        }
      }
    }
  }
  return { fraction: total ? matched / total : 0, lengthM: matched * p.sampleM };
}

export function destinationsSameArea(a: BuddyPresence, b: BuddyPresence, areaOf: AreaResolver): boolean {
  if (inAnyZone(a.destination, a.privacyZones) || inAnyZone(b.destination, b.privacyZones)) return false;
  if (areaOf(a.destination).id === areaOf(b.destination).id) return true;
  const ca = snapToCell(a.destination, C.areaCellSizeM).center;
  const cb = snapToCell(b.destination, C.areaCellSizeM).center;
  return haversineM(ca, cb) <= C.destAreaMatchM;
}

export interface PairEval {
  routeOk: boolean;
  sameArea: boolean;
  overlapFraction: number;
  overlapM: number;
  timeOverlapMin: number;
  base: number; // 0..~0.85, proximity is added by the view builder
}

/** Returns null when the pair is not compatible enough to ever be shown to each other. */
export function evaluatePair(
  a: BuddyPresence,
  b: BuddyPresence,
  runsA: LatLng[][],
  runsB: LatLng[][],
  areaOf: AreaResolver,
): PairEval | null {
  const overlapMin = timeOverlapMin(a, b);
  if (overlapMin < 0) return null;
  const prof = a.mode === "walk" && b.mode === "walk" ? C.profiles.walk : C.profiles.vehicle;
  const ov = routeOverlap(runsA, runsB, prof);
  const routeOk = ov.fraction >= prof.minOverlapFraction && ov.lengthM >= prof.minOverlapM;
  const sameArea = destinationsSameArea(a, b, areaOf);
  if (!routeOk && !sameArea) return null;
  const timeScore = 0.3 + 0.7 * Math.min(1, overlapMin / C.timeFullOverlapMin);
  const routeScore = routeOk ? ov.fraction : 0.35;
  const base =
    C.weights.route * routeScore + C.weights.time * timeScore + C.weights.mode * C.modeCompat[a.mode][b.mode];
  return { routeOk, sameArea, overlapFraction: ov.fraction, overlapM: ov.lengthM, timeOverlapMin: overlapMin, base };
}
