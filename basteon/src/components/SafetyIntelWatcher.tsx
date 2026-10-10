"use client";

import { useEffect, useRef } from "react";
import { distanceM } from "@/lib/hamba/geometry";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";

const MIN_INTERVAL_MS = 2 * 60_000;
const MIN_MOVE_M = 150;

/** Sends the position for server-side evaluation only when both the app setting and browser permission allow it. */
export function SafetyIntelWatcher() {
  const { settings, allowed } = useLocationEligibility();
  const enabled = allowed && Boolean(settings?.safetyIntelAlerts);
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);

  useEffect(() => {
    if (!enabled || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition((position) => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      const now = Date.now();
      const previous = last.current;
      if (previous && (now - previous.at < MIN_INTERVAL_MS || (distanceM(previous, point) < MIN_MOVE_M && now - previous.at < 10 * MIN_INTERVAL_MS))) return;
      last.current = { ...point, at: now };
      void fetch("/api/safety-intel/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(point) }).catch(() => undefined);
    }, () => undefined, { enableHighAccuracy: false, maximumAge: 60_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return null;
}
