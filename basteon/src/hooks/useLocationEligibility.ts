"use client";

import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { defaultPrivacy, locationEligibility, type PermissionState, type PrivacySettings } from "@/lib/locationEligibility";
import { checkLocationPermission } from "@/lib/platform/location";

export function useLocationEligibility() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [permission, setPermission] = useState<PermissionState>("prompt");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/account/privacy", { cache: "no-store" });
      setSettings(response.ok ? await response.json() as PrivacySettings : defaultPrivacy);
    } catch { setSettings(defaultPrivacy); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    let status: PermissionStatus | null = null;
    const sync = () => {
      void checkLocationPermission().then((value) => {
        if (active) setPermission(value as PermissionState);
      });
    };
    sync();
    if ("geolocation" in navigator && navigator.permissions?.query) {
      void navigator.permissions.query({ name: "geolocation" }).then((value) => {
        if (!active) return;
        status = value;
        if (!Capacitor.isNativePlatform()) {
          setPermission(value.state as PermissionState);
          value.addEventListener("change", sync);
        }
      }).catch(() => undefined);
    }
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      status?.removeEventListener("change", sync);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return { settings, refresh, ...locationEligibility(settings ? settings.liveLocationSharing : null, permission) };
}
