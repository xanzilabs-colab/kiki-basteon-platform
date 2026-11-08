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
