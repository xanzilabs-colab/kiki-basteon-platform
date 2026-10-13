"use client";

import { useEffect, useState } from "react";
import type { Position } from "@/lib/geo";
import { watchLocation } from "@/lib/platform/location";

function locationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("permission") || message.includes("denied")) return "Allow location access for Kiki in Android app settings.";
  if (message.includes("disabled") || message.includes("turned off") || message.includes("services")) return "Turn on Location services in Android settings.";
  return "Could not get your location. Check Location services and try again.";
}

export function useGeolocation() {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchLocation(
    (next) => {
      setPosition(next);
      setError(null);
    },
    (failure) => setError(locationErrorMessage(failure)),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
  ), []);

  return { position, error };
}