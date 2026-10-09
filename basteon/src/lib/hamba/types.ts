export type TripMode = "taxi" | "walk" | "ehail" | "bus" | "train";
export type RouteWatchState = "normal" | "watch" | "concern" | "alert";

export type GeoPoint = { lat: number; lng: number; accuracyM?: number; speedMps?: number; timestamp: number };
export type PlannedRoute = { points: GeoPoint[]; distanceM: number; durationS: number; alternatives: PlannedRoute[] };
export type RouteWatchReason = { signal: string; score: number; reason: string };
export type RouteWatchResult = { score: number; state: RouteWatchState; reasons: RouteWatchReason[]; confidence?: number };
export type TripRiskProfile = {
  offRouteBaseM: number;
  offRouteSustainS: number;
  stopToleranceS: number;
  etaOverrunFactor: number;
  checkInGraceS: number;
  alertScore: number;
  concernScore: number;
};