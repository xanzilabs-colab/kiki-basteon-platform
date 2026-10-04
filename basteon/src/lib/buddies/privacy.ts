import "server-only";

// SERVER ONLY. Uses node:crypto, so it will fail to bundle into client components (intended).
import { createHmac } from "node:crypto";
import { BUDDY_CONFIG as C } from "./config";
import { haversineM, resample } from "./geo";
import type { LatLng, PairBandState, PrivacyZone } from "./types";

function hmac(secret: string, ...parts: string[]): Buffer {
  return createHmac("sha256", secret).update(parts.join("|")).digest();
}
const u01 = (b: Buffer) => b.readUInt32BE(0) / 2 ** 32;

/** Opaque handle for a target, unique per viewer + per trip. Rotates every trip. */
export function opaqueRef(secret: string, viewerId: string, targetTripId: string): string {
  return hmac(secret, "ref", viewerId, targetTripId).toString("base64url").slice(0, 16);
}

/** Cosmetic angle. Stable for a pair so avatars don't jump, unrelated to real bearing. */
export function stableAngleDeg(secret: string, viewerTripId: string, targetTripId: string): number {
  return u01(hmac(secret, "ang", viewerTripId, targetTripId)) * 360;
}

/** Cosmetic radial position inside the ring (0.2..0.8). */
export function stableRadialPct(secret: string, viewerTripId: string, targetTripId: string): number {
  return 0.2 + 0.6 * u01(hmac(secret, "rad", viewerTripId, targetTripId));
}

/** Ring index for a distance, or -1 if beyond the outer ring. */
export function bandOf(distM: number, edges: number[] = C.bandEdgesM): number {
  for (let i = 0; i < edges.length; i++) if (distM <= edges[i]) return i;
  return -1;
}

/**
 * Hysteresis + rate limit on band changes. Without this, an observer who walks around
 * can watch the exact moment a band flips and use those crossing points to locate the target.
 */
export function stabiliseBand(prev: PairBandState | undefined, raw: number, now: number): PairBandState {
  if (!prev) return { band: raw, pending: null, pendingCount: 0, changedAt: now };
  if (raw === prev.band) return { ...prev, pending: null, pendingCount: 0 };
  if (now - prev.changedAt < C.minBandChangeIntervalMs) return prev;
  const count = prev.pending === raw ? prev.pendingCount + 1 : 1;
  if (count >= C.bandConfirmReadings) return { band: raw, pending: null, pendingCount: 0, changedAt: now };
  return { ...prev, pending: raw, pendingCount: count };
}

export function inAnyZone(p: LatLng, zones: PrivacyZone[]): boolean {
  return zones.some((z) => haversineM(p, z.center) <= z.radiusM);
}

/** Route pieces that lie OUTSIDE privacy zones. Matching only ever sees these. */
export function outsideZoneRuns(route: LatLng[], zones: PrivacyZone[], stepM = 50): LatLng[][] {
  if (zones.length === 0) return route.length >= 2 ? [route] : [];
  const pts = resample(route, stepM);
  const runs: LatLng[][] = [];
  let cur: LatLng[] = [];
  for (const p of pts) {
    if (inAnyZone(p, zones)) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** Keeps avatars in the same ring from piling on top of each other (cosmetic only). */
export function spreadAngles<T extends { ring: number; angleDeg: number }>(items: T[], minSep = C.angleMinSepDeg): void {
  const byRing = new Map<number, T[]>();
  for (const it of items) byRing.set(it.ring, [...(byRing.get(it.ring) ?? []), it]);
  for (const group of byRing.values()) {
    group.sort((a, b) => a.angleDeg - b.angleDeg);
    for (let i = 1; i < group.length; i++) {
      if (group[i].angleDeg - group[i - 1].angleDeg < minSep) group[i].angleDeg = group[i - 1].angleDeg + minSep;
    }
    for (const g of group) g.angleDeg = Math.round(g.angleDeg % 360);
  }
}

const BAD_KEY =
  /^(lat|lng|lon|latitude|longitude|position|coords?|coordinates?|distance|distanceM|dist|bearing|heading|address|phone|msisdn|surname|email|userId|user_id|route|polyline|origin|start|home|work)$/i;
const COORD_LIKE = /-?\d{1,3}\.\d{4,}/;

/** Belt and braces: throws if any outgoing object looks like it carries location or identity data. */
export function assertNoLeak(value: unknown, path = "$"): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (COORD_LIKE.test(value)) throw new Error(`Leak guard: coordinate-like string at ${path}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoLeak(v, `${path}[${i}]`));
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (BAD_KEY.test(k)) throw new Error(`Leak guard: forbidden key "${k}" at ${path}`);
      assertNoLeak(v, `${path}.${k}`);
    }
  }
}
