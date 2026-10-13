"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { reasonText } from "@/lib/locationEligibility";
import { requestLocationPermission } from "@/lib/platform/location";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";

function Row({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <div className="smart-safety-setting">
    <div><b>{label}</b><p>{description}</p></div>
    <button type="button" className="smart-safety-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}

export function LocationPrivacyCard() {
  const { settings, refresh, allowed, reason } = useLocationEligibility();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [settings]);

  async function save(patch: { liveLocationSharing?: boolean; safetyIntelAlerts?: boolean }) {
    setSaving(true);
    setError("");
    try {
      if (patch.liveLocationSharing && !await requestLocationPermission()) {
        throw new Error("Allow location access for Kiki in Android app settings, then try again.");
      }
      const response = await fetch("/api/account/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!response.ok) throw new Error("Could not save");
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your location settings. Try again.");
    } finally { setSaving(false); }
  }

  if (!settings) return null;
  return <section className="smart-safety-card">
    <h2><MapPin size={18} />Location &amp; community alerts</h2>
    <p className="smart-safety-intro">Both settings start off. Your location is only used while they are on, and you can turn them off at any time.</p>
    <Row label="Live Location Sharing" description="Lets Kiki use your current location for nearby responders and safety alerts. It also needs your device location permission." checked={settings.liveLocationSharing} disabled={saving} onChange={(value) => void save({ liveLocationSharing: value })} />
    <Row label="Safety Intelligence Alerts" description="Get a notification when community reports are near you. Reports are unverified unless marked otherwise. Requires Live Location Sharing." checked={settings.safetyIntelAlerts} disabled={saving || !settings.liveLocationSharing} onChange={(value) => void save({ safetyIntelAlerts: value })} />
    {settings.liveLocationSharing && !allowed && <p className="smart-safety-alert" role="status">{reasonText[reason]}</p>}
    {error && <p className="smart-safety-alert" role="alert">{error}</p>}
  </section>;
}
