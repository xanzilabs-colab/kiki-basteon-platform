import type { Alert } from "@/lib/types";

export function headingToCompass(heading: number | null | undefined) {
  if (heading == null || !Number.isFinite(heading)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = ((heading % 360) + 360) % 360;
  return dirs[Math.round(normalized / 45) % 8];
}

export function movementLabel(alert: Alert, now = Date.now()) {
  if (alert.is_simulated_loc) return "TEST LOCATION";
  const state = alert.motion_state ?? "unknown";
  if (state === "unknown") return "Motion unknown";
  if (state === "still") {
    const since = alert.motion_changed_at ? Math.max(0, now - new Date(alert.motion_changed_at).getTime()) : 0;
    const minutes = Math.floor(since / 60_000);
    return minutes > 0 ? `Stationary · ${minutes} min` : "Stationary";
  }
  const kmh = alert.speed_kmh != null ? `${Math.round(alert.speed_kmh)} km/h` : "moving";
  return `${state === "vehicle" ? "Moving" : "Walking"} · ${kmh} · ${headingToCompass(alert.heading_deg ?? null)}`;
}

export function isMovingAlert(alert: Alert) {
  return Boolean(alert.is_moving || alert.motion_state === "vehicle" || alert.motion_state === "walking");
}

export function deadReckon(
  lat: number,
  lng: number,
  speedKmh: number,
  headingDeg: number,
  elapsedMs: number,
) {
  const maxSeconds = 15;
  const seconds = Math.min(maxSeconds, Math.max(0, elapsedMs / 1000));
  const meters = (speedKmh * 1000 / 3600) * seconds;
  const earthRadius = 6_371_000;
  const heading = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angular = meters / earthRadius;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(heading),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(heading) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

