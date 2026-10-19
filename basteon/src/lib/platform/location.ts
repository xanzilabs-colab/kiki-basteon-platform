"use client";

import { Capacitor } from "@capacitor/core";
import { Geolocation, type PositionOptions } from "@capacitor/geolocation";
import type { Position } from "@/lib/geo";

export type LocationPermission = "granted" | "prompt" | "denied" | "disabled" | "unsupported";

type BrowserPositionOptions = {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
};

function fromCoordinates(
  coords: { latitude: number; longitude: number; accuracy: number; speed?: number | null; heading?: number | null },
  capturedAt: number,
): Position {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    capturedAt,
    speed: coords.speed,
    heading: coords.heading,
  };
}

function nativeOptions(options: BrowserPositionOptions): PositionOptions {
  return options;
}

export async function checkLocationPermission(): Promise<LocationPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const permissions = await Geolocation.checkPermissions();
      return permissions.location as LocationPermission;
    } catch {
      return "disabled";
    }
  }
  if (!("geolocation" in navigator)) return "unsupported";
  if (!navigator.permissions?.query) return "granted";
  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    return permission.state as LocationPermission;
  } catch {
    return "granted";
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const permissions = await Geolocation.requestPermissions();
      return permissions.location === "granted";
    } catch {
      return false;
    }
  }
  if (!("geolocation" in navigator)) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { timeout: 15_000, maximumAge: 0 },
    );
  });
}

export async function getCurrentLocation(options: BrowserPositionOptions = {}): Promise<Position> {
  if (Capacitor.isNativePlatform()) {
    const value = await Geolocation.getCurrentPosition(nativeOptions(options));
    return fromCoordinates(value.coords, value.timestamp);
  }
  if (!navigator.geolocation) throw new Error("Location is unavailable on this device.");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (value) => resolve(fromCoordinates(value.coords, value.timestamp)),
      reject,
      options,
    );
  });
}

export function watchLocation(
  onPosition: (position: Position) => void,
  onError: (error: unknown) => void,
  options: BrowserPositionOptions = {},
): () => void {
  if (Capacitor.isNativePlatform()) {
    let active = true;
    let watchId: string | null = null;
    void Geolocation.watchPosition(nativeOptions(options), (value, error) => {
      if (!active) return;
      if (error) {
        onError(error);
      } else if (value) {
        onPosition(fromCoordinates(value.coords, value.timestamp));
      }
    }).then((id) => {
      if (active) watchId = id;
      else void Geolocation.clearWatch({ id });
    }).catch(onError);
    return () => {
      active = false;
      if (watchId) void Geolocation.clearWatch({ id: watchId });
    };
  }

  if (!navigator.geolocation) {
    onError(new Error("Location is unavailable on this device."));
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    (value) => onPosition(fromCoordinates(value.coords, value.timestamp)),
    onError,
    options,
  );
  return () => navigator.geolocation.clearWatch(watchId);
}
