import { ROUTE_WATCH_PROFILES } from "./config";
import { distanceM, distanceToPolylineM } from "./geometry";
import type { GeoPoint, PlannedRoute, RouteWatchReason, RouteWatchResult, RouteWatchState, TripMode } from "./types";

type WatchInput = {
  mode: TripMode;
  route: PlannedRoute;
  fixes: GeoPoint[];
  startedAt: number;
  expectedArrivalAt: number;
  lastCheckInAt?: number;
  baselineP95DurationS?: number;
  areaRiskScore?: number;
  batteryLow?: boolean;
  now: number;
  previousState?: RouteWatchState;
};

function reason(signal: string, score: number, text: string): RouteWatchReason { return { signal, score, reason: text }; }

export function evaluateRouteWatch(input: WatchInput): RouteWatchResult {
  const profile = ROUTE_WATCH_PROFILES[input.mode];
  const latest = input.fixes.at(-1);
  if (!latest) return { score: 0, state: "normal", reasons: [], confidence: 0 };
  const reasons: RouteWatchReason[] = [];
  const accuracy = Math.max(0, latest.accuracyM ?? 25);
  const offRoute = distanceToPolylineM(latest, input.route.points);
  if (offRoute > profile.offRouteBaseM + accuracy * 1.5) reasons.push(reason("off_route", Math.min(45, Math.round(offRoute / 10)), `Off the planned route by ${Math.round(offRoute)} m.`));
  const previous = input.fixes.at(-2);
  const destination = input.route.points.at(-1)!;
  if (previous && distanceM(latest, destination) > distanceM(previous, destination) + 100) reasons.push(reason("moving_away", 34, "Moving away from the destination."));
  if (previous && latest.timestamp - previous.timestamp > profile.stopToleranceS * 1000 && distanceM(latest, previous) < Math.max(accuracy, 25)) reasons.push(reason("unexpected_stop", 28, "Stopped longer than expected for this trip mode."));
  if (previous && latest.timestamp - previous.timestamp > 180_000) reasons.push(reason("signal_loss", 16, "Location updates were interrupted; risk is uncertain."));
  if (accuracy > 100) reasons.push(reason("gps_quality", 8, "Location accuracy is low; route confidence is reduced."));
  const speedLimitMps = input.mode === "walk" ? 5.5 : 45;
  if ((latest.speedMps ?? 0) > speedLimitMps) {
    reasons.push(reason("speed_anomaly", input.mode === "walk" ? 10 : 18, input.mode === "walk"
      ? "Reported speed is unusual for walking; location may be imprecise."
      : "Reported vehicle speed is unusually high; location may be imprecise."));
  }
  if (input.mode === "taxi" && previous && (previous.speedMps ?? 0) > 8 && (latest.speedMps ?? 0) < 0.5
    && latest.timestamp - previous.timestamp < 120_000) {
    reasons.push(reason("sudden_stop", 16, "The vehicle stopped suddenly; this can also happen in normal traffic."));
  }
  if (input.fixes.length >= 3) {
    const beforePrevious = input.fixes.at(-3)!;
    const firstVector = { lat: previous!.lat - beforePrevious.lat, lng: previous!.lng - beforePrevious.lng };
    const secondVector = { lat: latest.lat - previous!.lat, lng: latest.lng - previous!.lng };
    const product = firstVector.lat * secondVector.lat + firstVector.lng * secondVector.lng;
    const magnitudes = Math.hypot(firstVector.lat, firstVector.lng) * Math.hypot(secondVector.lat, secondVector.lng);
    if (magnitudes > 0 && product / magnitudes < -0.5) {
      reasons.push(reason("heading_reversal", 14, "Recent movement changed direction sharply; this may be a route change."));
    }
  }
  const plannedDurationMs = input.expectedArrivalAt - input.startedAt;
  if (input.now > input.startedAt + plannedDurationMs * profile.etaOverrunFactor) reasons.push(reason("eta_overrun", 22, "Trip is taking substantially longer than planned."));
  if (input.baselineP95DurationS && input.now - input.startedAt > input.baselineP95DurationS * 1_000) {
    reasons.push(reason("learned_duration", 10, "This trip is taking longer than your recent similar trips."));
  }
  if (input.areaRiskScore && input.areaRiskScore > 0) {
    reasons.push(reason("area_reports", Math.min(15, Math.round(input.areaRiskScore / 7)), "Recent community reports near the route add context, but are not proof of danger."));
  }
  if (input.batteryLow) reasons.push(reason("low_battery", 5, "Your phone battery is low; location updates may stop sooner."));
  if (input.lastCheckInAt && input.now - input.lastCheckInAt > profile.checkInGraceS * 1000) reasons.push(reason("missed_check_in", 35, "A safety check-in was missed."));
  const score = Math.min(100, reasons.reduce((total, item) => total + item.score, 0));
  const corroborated = reasons.filter((item) => item.score >= 25).length >= 2;
  let state: RouteWatchState = score >= profile.alertScore && corroborated ? "alert" : score >= profile.concernScore ? "concern" : score >= 30 ? "watch" : "normal";
  if (input.previousState === "alert" && score >= profile.concernScore) state = "alert";
  if (input.previousState === "concern" && state === "watch" && score >= 45) state = "concern";
  const confidence = Math.max(0.1, Math.min(0.95,
    0.85 - (accuracy > 100 ? 0.25 : 0) - reasons.filter((item) => item.signal === "signal_loss").length * 0.3
    + Math.min(0.1, Math.max(0, input.fixes.length - 1) * 0.015)));
  return { score, state, reasons, confidence: Math.round(confidence * 100) / 100 };
}