import { ROUTE_WATCH_PROFILES } from "./config";
import { distanceM, distanceToPolylineM } from "./geometry";
import type { GeoPoint, PlannedRoute, RouteWatchReason, RouteWatchResult, RouteWatchState, TripMode } from "./types";

type WatchInput = { mode: TripMode; route: PlannedRoute; fixes: GeoPoint[]; startedAt: number; expectedArrivalAt: number; lastCheckInAt?: number; now: number; previousState?: RouteWatchState };

function reason(signal: string, score: number, text: string): RouteWatchReason { return { signal, score, reason: text }; }

export function evaluateRouteWatch(input: WatchInput): RouteWatchResult {
  const profile = ROUTE_WATCH_PROFILES[input.mode];
  const latest = input.fixes.at(-1);
  if (!latest) return { score: 0, state: "normal", reasons: [] };
  const reasons: RouteWatchReason[] = [];
  const accuracy = Math.max(0, latest.accuracyM ?? 25);
  const offRoute = distanceToPolylineM(latest, input.route.points);
  if (offRoute > profile.offRouteBaseM + accuracy * 1.5) reasons.push(reason("off_route", Math.min(45, Math.round(offRoute / 10)), `Off the planned route by ${Math.round(offRoute)} m.`));
  const previous = input.fixes.at(-2);
  const destination = input.route.points.at(-1)!;
  if (previous && distanceM(latest, destination) > distanceM(previous, destination) + 100) reasons.push(reason("moving_away", 34, "Moving away from the destination."));
  if (previous && latest.timestamp - previous.timestamp > profile.stopToleranceS * 1000 && distanceM(latest, previous) < Math.max(accuracy, 25)) reasons.push(reason("unexpected_stop", 28, "Stopped longer than expected for this trip mode."));
  if (previous && latest.timestamp - previous.timestamp > 180_000) reasons.push(reason("signal_loss", 16, "Location updates were interrupted; risk is uncertain."));
  const plannedDurationMs = input.expectedArrivalAt - input.startedAt;
  if (input.now > input.startedAt + plannedDurationMs * profile.etaOverrunFactor) reasons.push(reason("eta_overrun", 22, "Trip is taking substantially longer than planned."));
  if (input.lastCheckInAt && input.now - input.lastCheckInAt > profile.checkInGraceS * 1000) reasons.push(reason("missed_check_in", 35, "A safety check-in was missed."));
  const score = Math.min(100, reasons.reduce((total, item) => total + item.score, 0));
  const corroborated = reasons.filter((item) => item.score >= 25).length >= 2;
  let state: RouteWatchState = score >= profile.alertScore && corroborated ? "alert" : score >= profile.concernScore ? "concern" : score >= 30 ? "watch" : "normal";
  if (input.previousState === "alert" && score >= profile.concernScore) state = "alert";
  if (input.previousState === "concern" && state === "watch" && score >= 45) state = "concern";
  return { score, state, reasons };
}