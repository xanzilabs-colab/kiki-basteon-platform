import type { TripMode, TripRiskProfile } from "./types";

export const ROUTE_WATCH_PROFILES: Record<TripMode, TripRiskProfile> = {
  taxi: { offRouteBaseM: 120, offRouteSustainS: 90, stopToleranceS: 300, etaOverrunFactor: 1.7, checkInGraceS: 75, alertScore: 75, concernScore: 60 },
  ehail: { offRouteBaseM: 120, offRouteSustainS: 90, stopToleranceS: 300, etaOverrunFactor: 1.7, checkInGraceS: 75, alertScore: 75, concernScore: 60 },
  bus: { offRouteBaseM: 120, offRouteSustainS: 90, stopToleranceS: 300, etaOverrunFactor: 1.7, checkInGraceS: 75, alertScore: 75, concernScore: 60 },
  train: { offRouteBaseM: 120, offRouteSustainS: 90, stopToleranceS: 300, etaOverrunFactor: 1.7, checkInGraceS: 75, alertScore: 75, concernScore: 60 },
  walk: { offRouteBaseM: 55, offRouteSustainS: 60, stopToleranceS: 180, etaOverrunFactor: 1.45, checkInGraceS: 60, alertScore: 72, concernScore: 56 },
  cycling: { offRouteBaseM: 80, offRouteSustainS: 75, stopToleranceS: 240, etaOverrunFactor: 1.5, checkInGraceS: 70, alertScore: 74, concernScore: 58 },
};