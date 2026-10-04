import { BUDDY_CONFIG as C } from "./config";
import { haversineM } from "./geo";
import type { LatLng } from "./types";

export interface MeetCandidate {
  id: string;
  name: string;
  kind: string; // "fuel_station" | "mall" | "taxi_rank" | "pharmacy" | "spaza" ...
  position: LatLng;
  isSafePlace: boolean; // verified partner location
  openFrom?: number; // epoch ms, undefined = unknown
  openUntil?: number;
  litScore: number; // 0..1
  busyScore: number; // 0..1
  cctv: boolean;
  isolationScore: number; // 0..1, high = isolated / dead-end
  isPrivate?: boolean; // homes etc. are never suggested
}
export interface MeetMember {
  userId: string;
  position: LatLng;
  destination: LatLng;
  maxWalkM: number;
}
export interface MeetSuggestion {
  candidateId: string;
  name: string;
  kind: string;
  score: number;
  /** Safe to show to everyone in the bubble. Contains no member-specific distances. */
  shared: { reasons: string[] };
  /** Send each entry ONLY to that member. */
  perMember: Record<string, { walkMin: number }>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

export function suggestMeetingPoints(
  members: MeetMember[],
  candidates: MeetCandidate[],
  meetAt: number,
  walkDist: (a: LatLng, b: LatLng) => number = (a, b) => haversineM(a, b) * C.meeting.circuity,
): MeetSuggestion[] {
  const M = C.meeting;
  const out: MeetSuggestion[] = [];

  for (const cand of candidates) {
    if (cand.isPrivate) continue;
    if (cand.isolationScore > M.maxIsolationUnlessSafePlace && !cand.isSafePlace) continue;
    if (cand.openFrom !== undefined && cand.openFrom > meetAt) continue;
    if (cand.openUntil !== undefined && cand.openUntil < meetAt + M.openBufferMin * 60_000) continue;

    const walks = members.map((m) => walkDist(m.position, cand.position));
    if (walks.some((w, i) => w > members[i].maxWalkM)) continue;

    const maxW = Math.max(...walks);
    const minW = Math.min(...walks);
    const minAllowed = Math.min(...members.map((m) => m.maxWalkM));
    const spread = maxW > 0 ? (maxW - minW) / maxW : 0;
    const fairness = 0.7 * clamp01(1 - maxW / minAllowed) + 0.3 * (1 - spread);

    const safety = clamp01(
      0.3 * cand.litScore + 0.3 * cand.busyScore + 0.15 * (cand.cctv ? 1 : 0) + 0.25 * (cand.isSafePlace ? 1 : 0),
    );

    const detourRel = members.map((m, i) => {
      const direct = haversineM(m.position, m.destination);
      const via = walks[i] + haversineM(cand.position, m.destination);
      return Math.max(0, via - direct) / Math.max(direct, 500);
    });
    const direction = 1 - clamp01(detourRel.reduce((s, x) => s + x, 0) / detourRel.length / 0.5);

    const unknownHours = cand.openFrom === undefined && cand.openUntil === undefined;
    const score =
      M.weights.fairness * fairness +
      M.weights.safety * safety +
      M.weights.exposure * (1 - cand.isolationScore) +
      M.weights.direction * direction -
      (unknownHours ? M.unknownHoursPenalty : 0);

    const reasons: string[] = [];
    if (cand.isSafePlace) reasons.push("Verified safe place");
    if (cand.busyScore >= 0.6) reasons.push("Usually busy");
    if (cand.litScore >= 0.6) reasons.push("Well lit");
    if (cand.cctv) reasons.push("CCTV");
    if (cand.openUntil !== undefined) reasons.push(`Open until ${fmtTime(cand.openUntil)}`);
    if (spread < 0.35) reasons.push("Similar walk for everyone");

    out.push({
      candidateId: cand.id,
      name: cand.name,
      kind: cand.kind,
      score: Math.round(score * 1000) / 1000,
      shared: { reasons },
      perMember: Object.fromEntries(
        members.map((m, i) => [m.userId, { walkMin: Math.max(1, Math.round(walks[i] / M.walkSpeedMps / 60)) }]),
      ),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, M.topN);
}
