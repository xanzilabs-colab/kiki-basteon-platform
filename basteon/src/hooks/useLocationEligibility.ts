"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultPrivacy, locationEligibility, type PermissionState, type PrivacySettings } from "@/lib/locationEligibility";

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
    if (!("geolocation" in navigator)) { setPermission("unsupported"); return; }
    if (!navigator.permissions?.query) { setPermission("granted"); return; }
    let status: PermissionStatus | null = null;
    const sync = () => status && setPermission(status.state as PermissionState);
    void navigator.permissions.query({ name: "geolocation" }).then((value) => { status = value; sync(); value.addEventListener("change", sync); }).catch(() => setPermission("granted"));
    return () => status?.removeEventListener("change", sync);
  }, []);

  return { settings, refresh, ...locationEligibility(settings ? settings.liveLocationSharing : null, permission) };
}
