// lib/buddies/meeting/engine.ts
// The ranking brain. PURE: no network, no database, no Date.now() (time is passed in), so it is testable.
//
// Pipeline (see README): zone -> filter (hours, distance, exclusions) -> score -> pick 3..5 diverse options.
import { centroid, geometricMedian, haversineM, roadDistanceM } from "./geo";
import type {
  MeetCategory,
  MeetingZone,
  MemberInput,
  RankInput,
  RankOptions,
  RawCandidate,
  ScoredCandidate,
} from "./types";

export const DEFAULT_RANK_OPTIONS: RankOptions = {
  minScore: 55,
  minResults: 3,
  maxResults: 5,
  minSeparationM: 150,
  maxPerCategory: 2,
  nightStartHour: 19,
  nightEndHour: 6,
  alertRadiusM: 400,
  timeZone: "Africa/Johannesburg",
};

/** How "safe to meet a stranger" each kind of place is, before anything else. */
const CATEGORY_SAFETY: Record<MeetCategory, number> = {
  police_station: 1.0,
  hospital: 0.9,
  mall: 0.9,
  petrol_station: 0.85,
  supermarket: 0.8,
  cafe_restaurant: 0.8,
  transit_hub: 0.65,
  other_public: 0.6,
  school: 0.4,
  place_of_worship: 0.35,
  bus_stop: 0.3,
  taxi_rank: 0.3,
};

/** Only offered when there are not enough better options. Never offered at night. */
const LOW_TRUST: ReadonlySet<MeetCategory> = new Set<MeetCategory>(["school", "place_of_worship", "bus_stop", "taxi_rank"]);

/** Unverified landmarks (no opening hours known) are only allowed at night if they are staffed 24h-type places. */
const NIGHT_OK_LANDMARK: ReadonlySet<MeetCategory> = new Set<MeetCategory>(["police_station", "hospital", "petrol_station"]);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  const n = Number(h);
  return Number.isFinite(n) ? n : 12;
}

export function isNight(hour: number, o: Pick<RankOptions, "nightStartHour" | "nightEndHour">): boolean {
  return hour >= o.nightStartHour || hour < o.nightEndHour;
}

/** One meeting zone for the whole bubble: the middle of everybody's current location. */
export function computeMeetingZone(members: MemberInput[]): MeetingZone {
  if (members.length === 0) throw new Error("no members");
  const pts = members.map((m) => m.location);
  const center = pts.length >= 3 ? geometricMedian(pts) : centroid(pts);
  const maxToCenter = Math.max(...pts.map((p) => haversineM(p, center)));
  return {
    center,
    radiusM: clamp(maxToCenter * 1.2 + 400, 800, 6000),
    idealMaxM: maxToCenter * 1.3,
  };
}

/** null => do not offer this candidate right now. Otherwise a 0..1 factor for "is it open / usable". */
function hoursFactor(c: RawCandidate, night: boolean): number | null {
  if (c.source === "curated") {
    if (c.open24h || c.openNow === true) return 1;
    if (c.openNow === false) return null;
    return night ? null : 0.6; // hours unknown: daytime only
  }
  if (night) return NIGHT_OK_LANDMARK.has(c.category) ? 0.6 : null;
  return 0.7;
}

function safetyFactor(c: RawCandidate): number {
  const base = CATEGORY_SAFETY[c.category];
  if (c.source === "landmark") return base * 0.85;
  return clamp01(base * (0.8 + 0.05 * clamp(c.quality, 1, 5)));
}

/** 1 = lies on the way for everybody, 0 = big detour. Neutral 0.5 when nobody gave a destination. */
function onTheWayFactor(members: MemberInput[], c: RawCandidate): number {
  const withDest = members.filter((m) => m.destination !== null);
  if (withDest.length === 0) return 0.5;
  let sum = 0;
  for (const m of withDest) {
    const dest = m.destination as { lat: number; lng: number };
    const direct = haversineM(m.location, dest);
    const via = haversineM(m.location, c) + haversineM(c, dest);
    const ratio = (via - direct) / Math.max(direct, 500);
    sum += clamp01(1 - ratio);
  }
  return sum / withDest.length;
}

export function rankCandidates(input: RankInput, options: Partial<RankOptions> = {}): ScoredCandidate[] {
  const o: RankOptions = { ...DEFAULT_RANK_OPTIONS, ...options };
  const { members, zone, raw, alertPoints, now } = input;
  const night = isNight(localHour(now, o.timeZone), o);
  const skipSpots = new Set(input.excludeSpotIds);
  const skipOsm = new Set(input.excludeOsmRefs);

  // A landmark sitting on top of a curated spot is just a worse copy of it.
  const curated = raw.filter((c) => c.source === "curated");
  const pool = raw.filter((c) => {
    if (c.source === "curated") return !(c.spotId && skipSpots.has(c.spotId));
    if (c.osmRef && skipOsm.has(c.osmRef)) return false;
    return !curated.some((k) => haversineM(k, c) < 80);
  });

  const maxAllowed = zone.idealMaxM * 1.4 + 500; // anything needing a much longer trip is "out of the way"
  const scored: ScoredCandidate[] = [];

  for (const c of pool) {
    const hours = hoursFactor(c, night);
    if (hours === null) continue;

    const distM: Record<string, number> = {};
    let sum = 0;
    let max = 0;
    let min = Number.POSITIVE_INFINITY;
    for (const m of members) {
      const d = Math.round(roadDistanceM(m.location, c));
      distM[m.userId] = d;
      sum += d;
      max = Math.max(max, d);
      min = Math.min(min, d);
    }
    if (max > maxAllowed) continue;

    const avg = sum / members.length;
    const fairness = members.length > 1 ? 1 - (max - min) / Math.max(max, 1) : 1;
    const proximity = clamp01(1 - avg / maxAllowed);
    const safety = safetyFactor(c);
    const onTheWay = onTheWayFactor(members, c);
    const alerts = alertPoints.filter((p) => haversineM(p, c) <= o.alertRadiusM).length;

    let score = 100 * (0.3 * fairness + 0.22 * proximity + 0.28 * safety + 0.1 * hours + 0.1 * onTheWay);
    if (c.source === "curated") score += 8; // admin-checked beats anything scraped
    score -= Math.min(30, alerts * 10);
    const final = Math.round(clamp(score, 0, 100));
    if (final < o.minScore) continue;

    scored.push({
      ...c,
      score: final,
      distM,
      maxDistM: max,
      avgDistM: Math.round(avg),
      balanced: fairness >= 0.7,
      nearbyAlerts: alerts,
    });
  }

  return pickTop(scored, o);
}

/** 3..5 options: best first, no near-duplicates, no category flood, at least one curated spot if any qualified. */
export function pickTop(scored: ScoredCandidate[], o: RankOptions): ScoredCandidate[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.maxDistM - b.maxDistM);
  const picked: ScoredCandidate[] = [];

  const tryAdd = (c: ScoredCandidate): void => {
    if (picked.length >= o.maxResults) return;
    if (picked.some((p) => haversineM(p, c) < o.minSeparationM)) return;
    if (picked.filter((p) => p.category === c.category).length >= o.maxPerCategory) return;
    picked.push(c);
  };

  for (const c of sorted) if (!LOW_TRUST.has(c.category)) tryAdd(c);
  if (picked.length < o.minResults) {
    for (const c of sorted) {
      if (LOW_TRUST.has(c.category)) tryAdd(c);
      if (picked.length >= o.minResults) break;
    }
  }

  if (!picked.some((c) => c.source === "curated")) {
    const best = sorted.find((c) => c.source === "curated");
    if (best) {
      picked.sort((a, b) => b.score - a.score);
      if (picked.length >= o.maxResults) picked.pop();
      picked.push(best);
    }
  }
  return picked.sort((a, b) => b.score - a.score);
}
