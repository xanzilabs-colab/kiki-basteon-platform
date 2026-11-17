"use client";

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useState } from "react";
import { reasonText } from "@/lib/locationEligibility";
import { requestLocationPermission } from "@/lib/platform/location";
import { enablePushNotifications } from "@/lib/usePushNotifications";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";
import { AccountToggleRow } from "@/components/account/AccountList";

export function LocationPrivacyCard() {
  const { settings, refresh, allowed, reason } = useLocationEligibility();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(patch: { liveLocationSharing?: boolean; safetyIntelAlerts?: boolean }) {
    setSaving(true);
    setError("");
    try {
      if (patch.liveLocationSharing && !await requestLocationPermission()) {
        throw new Error("Allow location access for Kiki in Android app settings, then try again.");
      }
      let notificationWarning = "";
      if (patch.safetyIntelAlerts) {
        try {
          if (Capacitor.isNativePlatform()) {
            const current = await LocalNotifications.checkPermissions();
            const permission = current.display === "granted" ? current : await LocalNotifications.requestPermissions();
            if (permission.display !== "granted") notificationWarning = "Community alerts are enabled, but Kiki notifications are blocked in Android settings.";
          } else {
            await enablePushNotifications();
          }
        } catch (notificationError) {
          console.error("Could not enable community alert notifications", notificationError);
          notificationWarning = "Community alerts are enabled, but phone notifications could not be enabled.";
        }
      }
      const response = await fetch("/api/account/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error("Could not save");
      await refresh();
      if (notificationWarning) setError(notificationWarning);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your location settings. Try again.");
    } finally { setSaving(false); }
  }

  if (!settings) return null;
  return <div className="smart-safety-settings">
    <AccountToggleRow title="Live location sharing" subtitle="Share your location for nearby responders." checked={settings.liveLocationSharing} disabled={saving} onChange={(value) => void save({ liveLocationSharing: value })} />
    <AccountToggleRow title="Safety intelligence alerts" subtitle="Get nearby community report notifications." checked={settings.safetyIntelAlerts} disabled={saving || !settings.liveLocationSharing} onChange={(value) => void save({ safetyIntelAlerts: value })} />
    {settings.liveLocationSharing && !allowed && <p className="smart-safety-alert" role="status">{reasonText[reason]}</p>}
    {error && <p className="smart-safety-alert" role="alert">{error}</p>}
  </div>;
}
