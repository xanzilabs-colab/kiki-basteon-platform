import { distanceM, remainingRouteDistanceM } from "./geometry";

export type LatLng = { lat: number; lng: number };
export type TripTools = { auto: boolean; stops: boolean; draw: boolean };
export type ManualRoute = { points: LatLng[]; distanceM: number; durationS: number };

export const MODE_SPEED_MPS: Record<string, number> = { walk: 1.35, cycling: 4.2, taxi: 11, ehail: 11, bus: 8, train: 15 };

export const polylineLengthM = (points: LatLng[]) => points.slice(1).reduce((sum, point, i) => sum + distanceM(points[i], point), 0);

/** Evenly thins a drawn line so it can be sent to a routing service as waypoints. */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

/** Route built directly from the user's own geometry. Duration is an estimate from average mode speed. */
export function buildManualRoute(origin: LatLng, destination: LatLng, mode: string, stops: LatLng[], drawn: LatLng[]): ManualRoute {
  const points = [origin, ...stops, ...drawn, destination];
  const length = polylineLengthM(points);
  return { points, distanceM: Math.round(length), durationS: Math.max(60, Math.round(length / (MODE_SPEED_MPS[mode] ?? 8))) };
}

/** Expected arrival time for each stop, proportional to its position along the route. */
export function checkpointTimes(route: ManualRoute, stops: LatLng[], startMs: number) {
  const total = polylineLengthM(route.points);
  return stops.map((stop) => {
    const along = total > 0 ? Math.min(1, Math.max(0, (total - remainingRouteDistanceM(stop, route.points)) / total)) : 0;
    return startMs + Math.round(along * route.durationS * 1000);
  });
}
