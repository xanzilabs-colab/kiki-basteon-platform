export type Coordinate = { lat: number; lng: number };
export type RouteEstimate = {
  points: Coordinate[];
  distanceM: number;
  durationS: number | null;
  roadRoute: boolean;
};

const ROAD_DISTANCE_FACTOR = 1.3;
const URBAN_SPEED_KMH = 25;

export function estimateResponseRoute(origin: Coordinate, destination: Coordinate): RouteEstimate {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(destination.lat - origin.lat);
  const dLng = radians(destination.lng - origin.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(dLng / 2) ** 2;
  const straightDistanceM = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceM = Math.round(straightDistanceM * ROAD_DISTANCE_FACTOR);
  const durationS = Math.max(60, Math.round(distanceM / (URBAN_SPEED_KMH * 1_000 / 3_600)));

  return { points: [], distanceM, durationS, roadRoute: false };
}

export function formatResponseEta(route: RouteEstimate | undefined, responderStatus?: string) {
  if (responderStatus === "on_scene") return "On scene";
  if (!route) return "ETA unavailable";
  const durationS = route.durationS ?? Math.max(60, Math.round(route.distanceM / (URBAN_SPEED_KMH * 1_000 / 3_600)));
  const minutes = Math.max(1, Math.round(durationS / 60));
  return route.roadRoute && route.durationS !== null ? `~${minutes} min` : `~${minutes} min · estimated`;
}
