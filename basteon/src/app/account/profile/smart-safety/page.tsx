"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Brain, Clock3, Database, Route, ShieldCheck, Trash2 } from "lucide-react";
import { LocationPrivacyCard } from "@/components/LocationPrivacyCard";

type Settings = {
  learningEnabled: boolean;
  missedCheckinEnabled: boolean;
  routeHintsEnabled: boolean;
  shareHintsWithBuddies: boolean;
  buddyHintsEnabled: boolean;
  guardianNotifyEnabled: boolean;
  hintNotificationsEnabled: boolean;
  escalationDelayMinutes: number;
  quietHours: { enabled: boolean; start: string; end: string };
  retentionDays: number;
};
type DemoSession = { id: string; status: string; stage: string; reason: { text?: string } } | null;
const defaults: Settings = {
  learningEnabled: false,
  missedCheckinEnabled: false,
  routeHintsEnabled: false,
  shareHintsWithBuddies: false,
  buddyHintsEnabled: false,
  guardianNotifyEnabled: false,
  hintNotificationsEnabled: false,
  escalationDelayMinutes: 3,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
  retentionDays: 90,
};

function Toggle({ label, description, checked, onChange, disabled }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return <div className="smart-safety-setting">
    <div><b>{label}</b><p>{description}</p></div>
    <button type="button" className="smart-safety-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  </div>;
}

export default function SmartSafetyPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [savedSettings, setSavedSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoSession, setDemoSession] = useState<DemoSession>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/account/intelligence");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load Smart Safety settings.");
        const { demoEnabled: enabled, ...loaded } = data as Settings & { demoEnabled: boolean };
        setSettings(loaded);
        setSavedSettings(loaded);
        setDemoEnabled(enabled);
        if (enabled) {
          const demoResponse = await fetch("/api/account/intelligence/demo");
          const demoData = await demoResponse.json();
          if (!demoResponse.ok) throw new Error(demoData.error ?? "Could not load the demo.");
          setDemoSession(demoData.session);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load Smart Safety settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveSettings() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/intelligence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save settings.");
      setSavedSettings(settings);
      setMessage("Your Smart Safety preferences have been saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLearningData() {
    if (!window.confirm("Delete learned trip patterns, Smart Safety check-ins and hints? Your trip history and normal trip tracking will remain.")) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/intelligence", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not delete Smart Safety data.");
      setMessage(`Smart Safety learning data deleted. Your ${data.retainedTripHistory ? "trip history was kept" : "trip history was updated"}.`);
      if (demoEnabled) setDemoSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete Smart Safety data.");
    } finally {
      setSaving(false);
    }
  }

  async function runDemo(action: "start" | "advance" | "reset") {
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/intelligence/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The demo action failed.");
      setDemoSession(data.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo action failed.");
    }
  }

  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  return <div className="kiki-profile-hub smart-safety-page">
    <Link className="smart-safety-back" href="/account/profile"><ArrowLeft size={16} />Account settings</Link>
    <header><span>PRIVACY-FIRST CONTROLS</span><h1>Smart Safety</h1><p>Optional trip estimates, gentle check-ins and community route hints. Every feature starts off.</p></header>
    {error && <p className="smart-safety-alert" role="alert">{error}</p>}
    {message && <p className="smart-safety-success" role="status">{message}</p>}
    <LocationPrivacyCard />
    {loading ? <p>Loading your preferences…</p> : <section className="smart-safety-card">
      <h2><Brain size={18} />Personal trip learning</h2>
      <p className="smart-safety-intro">Kiki can learn broad origin/destination patterns from completed trips. It stores a one-way hash of coarse clusters, not your route points.</p>
      <Toggle label="Learn trip patterns" description="Use up to 30 recent trips to improve your time estimates. You can delete this data at any time." checked={settings.learningEnabled} disabled={saving} onChange={(value) => change("learningEnabled", value)} />

      <h2><Clock3 size={18} />Check-ins</h2>
      <Toggle label="Gentle missed-arrival check-ins" description="Show a check-in prompt when a trip runs late. Escalation only advances while this trip screen is open." checked={settings.missedCheckinEnabled} disabled={saving} onChange={(value) => change("missedCheckinEnabled", value)} />
      <div className="smart-safety-inline">
        <label>Wait before the next step
          <select className="input" value={settings.escalationDelayMinutes} disabled={saving} onChange={(event) => change("escalationDelayMinutes", Number(event.target.value))}>
            {[1, 3, 5, 10, 15, 20, 30].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
      </div>
      <Toggle label="Quiet hours" description="Suppress check-in notifications during the selected UTC time window. In-app prompts remain available." checked={settings.quietHours.enabled} disabled={saving} onChange={(value) => change("quietHours", { ...settings.quietHours, enabled: value })} />
      <div className="smart-safety-times">
        <label>Start (UTC)<input className="input" type="time" value={settings.quietHours.start} disabled={saving} onChange={(event) => change("quietHours", { ...settings.quietHours, start: event.target.value })} /></label>
        <label>End (UTC)<input className="input" type="time" value={settings.quietHours.end} disabled={saving} onChange={(event) => change("quietHours", { ...settings.quietHours, end: event.target.value })} /></label>
      </div>

      <h2><Route size={18} />Route suggestions</h2>
      <Toggle label="Community and safe-place hints" description="Use recent public reports and approved safe places to suggest route options. Reports are not treated as verified facts." checked={settings.routeHintsEnabled} disabled={saving} onChange={(value) => change("routeHintsEnabled", value)} />
      <Toggle label="Share a general safety tip with mutual Buddies" description="Sends only a generic tip notification to mutual, unblocked Buddies. It never shares your route or location." checked={settings.shareHintsWithBuddies} disabled={saving} onChange={(value) => change("shareHintsWithBuddies", value)} />
      {settings.guardianNotifyEnabled && <p className="smart-safety-note">Guardian delivery is not available in this app yet. Kiki will not claim to have contacted anyone.</p>}
      <Toggle label="Guardian notifications" description="No SMS or guardian delivery channel is configured; enabling this does not send a message." checked={settings.guardianNotifyEnabled} disabled={saving} onChange={(value) => change("guardianNotifyEnabled", value)} />

      <h2><Database size={18} />Data controls</h2>
      <label className="smart-safety-inline">Keep learned trip samples for
        <select className="input" value={settings.retentionDays} disabled={saving} onChange={(event) => change("retentionDays", Number(event.target.value))}>
          {[30, 60, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}
        </select>
      </label>
      <p className="smart-safety-note">Trip history is separate. Deleting Smart Safety data never deletes your trip history or normal tracking records.</p>
      <div className="smart-safety-actions">
        <button className="btn btn-primary" type="button" disabled={!dirty || saving} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save preferences"}</button>
        <button className="btn smart-safety-delete" type="button" disabled={saving} onClick={() => void deleteLearningData()}><Trash2 size={16} />Delete learning data</button>
      </div>
    </section>}

    {demoEnabled && <section className="smart-safety-card smart-safety-demo">
      <h2><ShieldCheck size={18} />Isolated demonstration</h2>
      <p className="smart-safety-intro">Synthetic check-in stages only. The demo never reads or changes a real trip, location, report or contact.</p>
      <p><b>Current stage:</b> {demoSession?.stage ?? "Not started"}</p>
      {demoSession?.reason.text && <p>{demoSession.reason.text}</p>}
      <div className="smart-safety-actions">
        {!demoSession || demoSession.status === "resolved"
          ? <button className="btn btn-primary" type="button" onClick={() => void runDemo("start")}>Start demo</button>
          : <button className="btn btn-primary" type="button" onClick={() => void runDemo("advance")}>Advance demo stage</button>}
        {demoSession && <button className="btn" type="button" onClick={() => void runDemo("reset")}>Reset demo</button>}
      </div>
    </section>}
  </div>;
}
