import type { Mode } from "./types";

export interface OverlapProfile {
  corridorM: number;
  maxBearingDiffDeg: number;
  minOverlapM: number;
  minOverlapFraction: number;
  sampleM: number;
}

/** Every threshold lives here. Tune with real data, never inline. */
export const BUDDY_CONFIG = {
  // --- map / privacy ---
  bandEdgesM: [300, 1000, 3000], // ring outer edges (3 rings)
  cellSizeM: 250, // positions are snapped to this grid BEFORE any distance maths
  areaCellSizeM: 1500, // fallback "general area" grid for destinations
  destAreaMatchM: 1200, // destinations this close count as the same area
  maxAvatars: 12, // hard cap per response (limits harvesting)
  angleMinSepDeg: 26, // cosmetic spacing between avatars in a ring
  minRefreshMs: 5_000, // Keep Bubble grouping responsive without exposing exact positions.
  bandConfirmReadings: 2, // readings needed to confirm a band change
  minBandChangeIntervalMs: 120_000, // min time between band changes per pair

  // --- matching ---
  profiles: {
    walk: { corridorM: 150, maxBearingDiffDeg: 50, minOverlapM: 400, minOverlapFraction: 0.4, sampleM: 75 },
    vehicle: { corridorM: 400, maxBearingDiffDeg: 45, minOverlapM: 1500, minOverlapFraction: 0.4, sampleM: 200 },
  } as Record<"walk" | "vehicle", OverlapProfile>,
  weights: { route: 0.45, time: 0.25, mode: 0.15, proximity: 0.15 },
  timeFullOverlapMin: 10,
  leavingSoonMin: 10,
  modeCompat: {
    walk: { walk: 1, taxi: 0.3, ehail: 0.3, bus: 0.4, train: 0.3 },
    taxi: { walk: 0.3, taxi: 1, ehail: 0.5, bus: 0.5, train: 0.3 },
    ehail: { walk: 0.3, taxi: 0.5, ehail: 1, bus: 0.3, train: 0.2 },
    bus: { walk: 0.4, taxi: 0.5, ehail: 0.3, bus: 1, train: 0.4 },
    train: { walk: 0.3, taxi: 0.3, ehail: 0.2, bus: 0.4, train: 1 },
  } as Record<Mode, Record<Mode, number>>,

  // --- meeting point ---
  meeting: {
    circuity: 1.3, // straight-line to walking distance fallback
    walkSpeedMps: 1.25,
    maxIsolationUnlessSafePlace: 0.7,
    openBufferMin: 30, // must stay open this long after meet time
    unknownHoursPenalty: 0.05,
    weights: { fairness: 0.35, safety: 0.3, exposure: 0.2, direction: 0.15 },
    topN: 3,
  },

  // --- abuse guard ---
  guard: {
    maxQueriesPerMinute: 12,
    maxDistinctProfilesPerDay: 40,
    trackWindowMs: 30 * 60_000,
    trackMinObservations: 6,
    trackMinSpanM: 1500,
    trackMinBandChanges: 3,
  },
  ping: {
    maxPingsPerDay: 10,
    maxPingsPerTargetPerTrip: 1,
    declineCooldownMs: 7 * 24 * 3600_000,
  },
};
