"use client";

import { useCallback, useEffect, useState } from "react";
import { hasUsableLocationAccuracy, hasUsableMapLocationAccuracy, isFreshPosition, LOCATION_FIX_MAX_AGE_MS, type Position } from "@/lib/geo";
import { getCurrentLocation, locationErrorMessage, watchLocation } from "@/lib/platform/location";

function locationAccuracyMessage(position: Position) {
  if (typeof position.accuracy !== "number" || !Number.isFinite(position.accuracy)) {
    return "Your device did not report location accuracy. Enable precise location to plan a route.";
  }
  const uncertainty = position.accuracy >= 1_000
    ? `${(position.accuracy / 1_000).toFixed(1)} km`
    : `${Math.ceil(position.accuracy)} m`;
  return `Your device only provided an approximate location (about ${uncertainty} uncertainty). Enable precise location to plan a route; buddy maps can use locations accurate to within 1 km.`;
}

export function useGeolocation() {
  const [position, setPosition] = useState<Position | null>(null);
  const [approximatePosition, setApproximatePosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watchVersion, setWatchVersion] = useState(0);

  const acceptPosition = useCallback((next: Position) => {
    setApproximatePosition(hasUsableMapLocationAccuracy(next) ? next : null);
    if (!hasUsableLocationAccuracy(next)) {
      setPosition(null);
      setError(locationAccuracyMessage(next));
      return;
    }
    setPosition(next);
    setError(null);
  }, []);

  useEffect(() => {
    try {
      return watchLocation(
        acceptPosition,
        (failure) => {
          setPosition(null);
          setApproximatePosition(null);
          setError(locationErrorMessage(failure));
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } catch (failure) {
      setPosition(null);
      setApproximatePosition(null);
      setError(locationErrorMessage(failure));
      return;
    }
  }, [acceptPosition, watchVersion]);

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

  useEffect(() => {
    if (!approximatePosition) return;
    const remaining = LOCATION_FIX_MAX_AGE_MS - (Date.now() - (approximatePosition.capturedAt ?? 0));
    if (remaining <= 0 || !isFreshPosition(approximatePosition)) {
      setApproximatePosition(null);
      return;
    }
    const timer = window.setTimeout(() => setApproximatePosition(null), remaining);
    return () => window.clearTimeout(timer);
  }, [approximatePosition]);

  const refreshLocation = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await getCurrentLocation({ enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
      acceptPosition(next);
    } catch (failure) {
      setPosition(null);
      setApproximatePosition(null);
      setError(locationErrorMessage(failure));
    } finally {
      setRefreshing(false);
      setWatchVersion((version) => version + 1);
    }
  }, [acceptPosition]);

  return { position, approximatePosition, error, refreshing, refreshLocation };
}