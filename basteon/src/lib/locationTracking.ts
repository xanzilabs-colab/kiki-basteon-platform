import type { Alert } from "@/lib/types";

export type LocationHealth = "live" | "delayed" | "stale";

export function expectedLocationIntervalMs(triggeredAt: string, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(triggeredAt).getTime());
  if (ageMs <= 2 * 60_000) return 10_000;
  if (ageMs <= 10 * 60_000) return 30_000;
  if (ageMs <= 60 * 60_000) return 60_000;
  return 300_000;
}

export function locationAgeMs(alert: Alert, now = Date.now()) {
  return Math.max(0, now - new Date(alert.last_location_at ?? alert.triggered_at).getTime());
}

export function locationHealth(alert: Alert, now = Date.now()): LocationHealth {
  const expected = expectedLocationIntervalMs(alert.triggered_at, now);
  const age = locationAgeMs(alert, now);
  if (age >= expected * 6) return "stale";
  if (age >= expected * 3) return "delayed";
  return "live";
}