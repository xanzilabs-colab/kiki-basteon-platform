import { BUDDY_CONFIG as C } from "./config";
import { haversineM, snapToCell } from "./geo";
import { cellAreaResolver, evaluatePair } from "./matching";
import {
  assertNoLeak, bandOf, inAnyZone, opaqueRef, outsideZoneRuns,
  spreadAngles, stableAngleDeg, stableRadialPct, stabiliseBand,
} from "./privacy";
import type { AreaResolver, Badge, BuddyPresence, LatLng, NearbyAvatar, PairBandState } from "./types";

export interface BuildCtx {
  viewer: BuddyPresence;
  now: number;
  secret: string; // BUDDY_HMAC_SECRET, server env only
  areaOf?: AreaResolver;
  pairStates?: Record<string, PairBandState>; // persist between calls (Redis / table)
}
export interface NearbyResult {
  avatars: NearbyAvatar[];
  nextPairStates: Record<string, PairBandState>;
  empty?: "not_visible" | "no_active_trip" | "in_privacy_zone" | "not_verified";
}

const presentable = (p: BuddyPresence) =>
  p.visible && p.verified && !p.suspended && p.tripActive && !inAnyZone(p.position, p.privacyZones);
const audienceAllows = (owner: BuddyPresence, other: BuddyPresence) =>
  owner.audience === "all_verified" || owner.contactIds.includes(other.userId);
const blocked = (a: BuddyPresence, b: BuddyPresence) =>
  a.blockedIds.includes(b.userId) || b.blockedIds.includes(a.userId);

/**
 * The single gateway between exact server data and what a client may see.
 * Reciprocal: you only see others while you are visible, verified, on an active trip and outside your privacy zones.
 */
export function buildNearbyView(ctx: BuildCtx, candidates: BuddyPresence[]): NearbyResult {
  const { viewer, now, secret } = ctx;
  const areaOf = ctx.areaOf ?? cellAreaResolver;
  const prevStates = ctx.pairStates ?? {};
  const nextPairStates: Record<string, PairBandState> = {};

  if (!viewer.verified || viewer.suspended) return { avatars: [], nextPairStates, empty: "not_verified" };
  if (!viewer.tripActive) return { avatars: [], nextPairStates, empty: "no_active_trip" };
  if (!viewer.visible) return { avatars: [], nextPairStates, empty: "not_visible" };
  if (inAnyZone(viewer.position, viewer.privacyZones)) return { avatars: [], nextPairStates, empty: "in_privacy_zone" };

  const runs = new Map<string, LatLng[][]>();
  const runsOf = (p: BuddyPresence) => {
    if (!runs.has(p.tripId)) runs.set(p.tripId, outsideZoneRuns(p.route, p.privacyZones));
    return runs.get(p.tripId)!;
  };

  const vCell = snapToCell(viewer.position, C.cellSizeM).center;
  const outer = C.bandEdgesM[C.bandEdgesM.length - 1];
  const scored: { c: BuddyPresence; score: number; band: number; rawDist: number; routeOk: boolean; sameArea: boolean }[] = [];

  for (const c of candidates) {
    if (c.userId === viewer.userId || !presentable(c) || blocked(viewer, c)) continue;
    if (!audienceAllows(c, viewer) || !audienceAllows(viewer, c)) continue;

    // Distance is measured between grid-cell centres, never exact positions.
    const rawDist = haversineM(vCell, snapToCell(c.position, C.cellSizeM).center);
    const raw = bandOf(rawDist);
    if (raw < 0 || rawDist > outer) continue;

    const key = `${viewer.tripId}|${c.tripId}`;
    const st = stabiliseBand(prevStates[key], raw, now);
    nextPairStates[key] = st;

    const ev = evaluatePair(viewer, c, runsOf(viewer), runsOf(c), areaOf);
    const prox = C.weights.proximity * (1 - st.band / C.bandEdgesM.length);
    scored.push({ c, score: (ev?.base ?? 0) + prox, band: st.band, rawDist, routeOk: ev?.routeOk ?? false, sameArea: ev?.sameArea ?? false });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, C.maxAvatars);
  const closestTrip = [...top].sort((a, b) => a.rawDist - b.rawDist)[0]?.c.tripId;

  const avatars: NearbyAvatar[] = top.map(({ c, band, routeOk, sameArea }) => {
    const badges: Badge[] = [];
    if (sameArea) badges.push("same_destination_area");
    if (routeOk) badges.push("going_your_way");
    if (c.leaveFrom <= now + C.leavingSoonMin * 60_000) badges.push("leaving_soon");
    if (c.tripId === closestTrip) badges.push("closest");
    const hideDest = inAnyZone(c.destination, c.privacyZones);
    return {
      ref: opaqueRef(secret, viewer.userId, c.tripId),
      nickname: c.nickname,
      avatar: c.avatar,
      ring: band,
      angleDeg: stableAngleDeg(secret, viewer.tripId, c.tripId),
      radialPct: Math.round(stableRadialPct(secret, viewer.tripId, c.tripId) * 100) / 100,
      badges,
      destinationArea: hideDest ? null : areaOf(c.destination).label,
      mode: c.mode,
    };
  });

  spreadAngles(avatars);
  assertNoLeak(avatars);
  return { avatars, nextPairStates };
}

/** Resolve a client-supplied ref back to a user. Only valid if it is in the viewer's CURRENT view. */
export function resolveRef(
  secret: string,
  viewerId: string,
  currentAvatars: NearbyAvatar[],
  candidates: BuddyPresence[],
  ref: string,
): BuddyPresence | null {
  if (!currentAvatars.some((a) => a.ref === ref)) return null;
  return candidates.find((c) => opaqueRef(secret, viewerId, c.tripId) === ref) ?? null;
}
