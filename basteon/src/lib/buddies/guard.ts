import { BUDDY_CONFIG as C } from "./config";
import { haversineM } from "./geo";
import type { LatLng } from "./types";

/** Log one of these (server side) for every nearby-map response you serve. Keep ~24h. */
export interface QueryEvent {
  t: number;
  viewer: LatLng; // viewer's snapped position at query time
  refs: string[]; // refs returned
  bands: Record<string, number>; // ref -> ring returned
}
export interface GuardDecision {
  action: "allow" | "throttle" | "flag" | "block";
  reasons: string[];
}

export function evaluateQueryPattern(events: QueryEvent[], now: number): GuardDecision {
  const G = C.guard;
  const reasons: string[] = [];
  let action: GuardDecision["action"] = "allow";
  const bump = (a: GuardDecision["action"]) => {
    const order = ["allow", "throttle", "flag", "block"];
    if (order.indexOf(a) > order.indexOf(action)) action = a;
  };

  if (events.filter((e) => e.t > now - 60_000).length > G.maxQueriesPerMinute) {
    bump("throttle");
    reasons.push("query_rate");
  }

  const day = events.filter((e) => e.t > now - 24 * 3600_000);
  if (new Set(day.flatMap((e) => e.refs)).size >= G.maxDistinctProfilesPerDay) {
    bump("block");
    reasons.push("too_many_profiles");
  }

  // Trilateration pattern: same target seen repeatedly while the viewer travels widely and its ring keeps changing.
  const win = events.filter((e) => e.t > now - G.trackWindowMs).slice(-40);
  const refs = new Set(win.flatMap((e) => e.refs));
  for (const ref of refs) {
    const evs = win.filter((e) => e.refs.includes(ref));
    if (evs.length < G.trackMinObservations) continue;
    let span = 0;
    for (let i = 0; i < evs.length; i++)
      for (let j = i + 1; j < evs.length; j++) span = Math.max(span, haversineM(evs[i].viewer, evs[j].viewer));
    let changes = 0;
    for (let i = 1; i < evs.length; i++) if (evs[i].bands[ref] !== evs[i - 1].bands[ref]) changes++;
    if (span >= G.trackMinSpanM && changes >= G.trackMinBandChanges) {
      bump("flag");
      reasons.push("tracking_pattern");
      break;
    }
  }
  return { action, reasons };
}

export interface PingState {
  pingsToday: number;
  pingsToThisTargetThisTrip: number;
  lastDeclinedAt: number | null;
  blockedEitherWay: boolean;
}

export function canPing(s: PingState, now: number): { ok: boolean; reason?: string } {
  const P = C.ping;
  if (s.blockedEitherWay) return { ok: false, reason: "blocked" };
  if (s.pingsToday >= P.maxPingsPerDay) return { ok: false, reason: "daily_limit" };
  if (s.pingsToThisTargetThisTrip >= P.maxPingsPerTargetPerTrip) return { ok: false, reason: "already_pinged" };
  if (s.lastDeclinedAt !== null && now - s.lastDeclinedAt < P.declineCooldownMs) return { ok: false, reason: "cooldown" };
  return { ok: true };
}
