"use client";

import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { hasUsableLocationAccuracy, isFreshPosition, LOCATION_FIX_MAX_AGE_MS, type Position } from "@/lib/geo";
import { getCurrentLocation, watchLocation } from "@/lib/platform/location";

function locationAccuracyMessage(position: Position) {
  if (typeof position.accuracy !== "number" || !Number.isFinite(position.accuracy)) {
    return "Your browser did not report location accuracy. Enable Windows Location services and retry; Kiki will not use an unverified location.";
  }
  return `Your browser only provided a rough location (about ${Math.ceil(position.accuracy / 1000)} km uncertainty). Enable Windows Location services and retry; Kiki will not use this as your live location.`;
}

export function locationErrorMessage(error: unknown) {
  const native = Capacitor.isNativePlatform();
  if (!native && typeof window !== "undefined" && !window.isSecureContext) {
    return "Browser location requires HTTPS. Open Kiki using its secure https:// address.";
  }
  if (!native && typeof navigator !== "undefined" && !navigator.geolocation) {
    return "This browser does not support location. Open Kiki in a current browser.";
  }
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
    ? error.code
    : null;
  if (!native && code === 1) return "Location permission is blocked. Allow location for Kiki in browser site settings, then retry. On Windows, also turn on Location services.";
  if (!native && code === 2) return "Your PC could not determine its location. Turn on Windows Location services, allow location for this site, and retry.";
  if (!native && code === 3) return "Location lookup timed out. Check Windows Location services and your connection, then retry.";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("permission") || message.includes("denied")) return "Allow location access for Kiki in Android app settings.";
  if (message.includes("disabled") || message.includes("turned off") || message.includes("services")) return "Turn on Location services in Android settings.";
  return native
    ? "Could not get your location. Check Android app permission and Location services, then retry."
    : "Could not get your location. Check your browser’s site permission and Windows Location services, then retry.";
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