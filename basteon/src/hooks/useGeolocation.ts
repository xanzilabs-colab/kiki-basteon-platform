"use client";

import { useCallback, useEffect, useState } from "react";
import { hasUsableLocationAccuracy, isFreshPosition, LOCATION_FIX_MAX_AGE_MS, type Position } from "@/lib/geo";
import { getCurrentLocation, locationErrorMessage, watchLocation } from "@/lib/platform/location";

function locationAccuracyMessage(position: Position) {
  if (typeof position.accuracy !== "number" || !Number.isFinite(position.accuracy)) {
    return "Your browser did not report location accuracy. Enable Windows Location services and retry; Kiki will not use an unverified location.";
  }
  return `Your browser only provided a rough location (about ${Math.ceil(position.accuracy / 1000)} km uncertainty). Enable Windows Location services and retry; Kiki will not use this as your live location.`;
}

export function useGeolocation() {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watchVersion, setWatchVersion] = useState(0);

  useEffect(() => {
    try {
      return watchLocation(
        (next) => {
          if (!hasUsableLocationAccuracy(next)) {
            setPosition(null);
            setError(locationAccuracyMessage(next));
            return;
          }
          setPosition(next);
          setError(null);
        },
        (failure) => {
          setPosition(null);
          setError(locationErrorMessage(failure));
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } catch (failure) {
      setPosition(null);
      setError(locationErrorMessage(failure));
      return;
    }
  }, [watchVersion]);

  useEffect(() => {
    if (!position) return;
    const remaining = LOCATION_FIX_MAX_AGE_MS - (Date.now() - (position.capturedAt ?? 0));
    if (remaining <= 0 || !isFreshPosition(position)) {
      setPosition(null);
      setError("Your location fix expired. Request a fresh location before continuing.");
      return;
    }
    const timer = window.setTimeout(() => {
      setPosition(null);
      setError("Your location fix expired. Request a fresh location before continuing.");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [position]);

  const refreshLocation = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await getCurrentLocation({ enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
      if (!hasUsableLocationAccuracy(next)) {
        setPosition(null);
        setError(locationAccuracyMessage(next));
      } else {
        setPosition(next);
        setError(null);
      }
    } catch (failure) {
      setPosition(null);
      setError(locationErrorMessage(failure));
    } finally {
      setRefreshing(false);
      setWatchVersion((version) => version + 1);
    }
  }, []);

  return { position, error, refreshing, refreshLocation };
}