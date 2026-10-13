"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalmShell, usePersistentMute } from "./CalmShell";
import styles from "./calm.module.css";

export type CalmSettings = {
  saveHistory: boolean;
  haptics: boolean;
  sound: boolean;
  breathPace: "gentle" | "standard";
  breathHolds: boolean;
  baselineLevel: 1 | 2 | 3;
};

export const DEFAULT_CALM_SETTINGS: CalmSettings = {
  saveHistory: false,
  haptics: true,
  sound: true,
  breathPace: "gentle",
  breathHolds: false,
  baselineLevel: 1,
};

export async function fetchCalmSettings(): Promise<CalmSettings> {
  const response = await fetch("/api/calm/settings", { cache: "no-store" });
  if (!response.ok) throw new Error("Couldn't load Calm settings.");
  return response.json() as Promise<CalmSettings>;
}

export async function saveCalmSettings(settings: CalmSettings): Promise<void> {
  const response = await fetch("/api/calm/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error("Couldn't save Calm settings.");
}

export type CalmSession = {
  id: string;
  tool: "winds" | "baseline" | "body";
  mode: string | null;
  started_at: string;
  duration_s: number;
  completed: boolean;
  rating_before: number | null;
  rating_after: number | null;
  payload: Record<string, unknown>;
};

export async function fetchCalmHistory(): Promise<CalmSession[]> {
  const response = await fetch("/api/calm/history", { cache: "no-store" });
  if (!response.ok) throw new Error("Couldn't load Calm history.");
  return response.json() as Promise<CalmSession[]>;
}

export async function saveCalmSession(input: Record<string, unknown>) {
  const response = await fetch("/api/calm/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Couldn't save this Calm session.");
  return response.json() as Promise<{ saved: boolean }>;
}

export function CalmSettingsPage() {
  const [settings, setSettings] = useState<CalmSettings>(DEFAULT_CALM_SETTINGS);
  const [muted, setMuted] = usePersistentMute();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchCalmSettings().then((value) => { if (active) setSettings(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Couldn't load Calm settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await saveCalmSettings(settings);
      setMessage("Your Calm settings are saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save Calm settings.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    if (!window.confirm("Delete your saved Calm sessions and settings? This cannot be undone.")) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/calm/my-data", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn't delete your Calm data.");
      setSettings(DEFAULT_CALM_SETTINGS);
      setMessage("Your saved Calm data has been deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't delete your Calm data.");
    } finally {
      setBusy(false);
    }
  }

  const stop = () => { window.location.assign("/account/calm"); };
  return (
    <CalmShell title="Settings" onStop={stop} muted={muted} onMuteChange={setMuted}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Your choices</p>
        <h1>Calm settings</h1>
        <p className={styles.lede}>History is private and off by default. You can change or delete these choices at any time.</p>
        {loading ? <p role="status">Loading settings…</p> : <>
          <label className={styles.settingRow}><span><b>Save session history</b><small>Stores only short summaries for gentle trends. No journal notes or trivia answers. Turning this off hides history but does not delete it; use Delete my calm data to remove it.</small></span><input type="checkbox" checked={settings.saveHistory} onChange={(event) => setSettings((value) => ({ ...value, saveHistory: event.target.checked }))} /></label>
          <label className={styles.settingRow}><span><b>Haptics</b><small>Use gentle vibration cues where your device supports them.</small></span><input type="checkbox" checked={settings.haptics} onChange={(event) => setSettings((value) => ({ ...value, haptics: event.target.checked }))} /></label>
          <label className={styles.settingRow}><span><b>Sound</b><small>Soft optional cues in Quiet mode. The header mute also silences them.</small></span><input type="checkbox" checked={settings.sound} onChange={(event) => setSettings((value) => ({ ...value, sound: event.target.checked }))} /></label>
          <label className={styles.settingRow}><span><b>Breathing pace</b><small>Gentle stretches each phase. Standard uses the suggested pace.</small></span><select value={settings.breathPace} onChange={(event) => setSettings((value) => ({ ...value, breathPace: event.target.value as CalmSettings["breathPace"] }))}><option value="gentle">Gentle</option><option value="standard">Standard</option></select></label>
          <label className={styles.settingRow}><span><b>Breathing holds</b><small>Optional pauses in Box breathing. Off by default.</small></span><input type="checkbox" checked={settings.breathHolds} onChange={(event) => setSettings((value) => ({ ...value, breathHolds: event.target.checked }))} /></label>
          <label className={styles.settingRow}><span><b>Spot the Baseline level</b><small>Choose a comfortable level. It never decreases automatically.</small></span><select value={settings.baselineLevel} onChange={(event) => setSettings((value) => ({ ...value, baselineLevel: Number(event.target.value) as CalmSettings["baselineLevel"] }))}><option value={1}>1 · Easy</option><option value={2}>2 · Steady</option><option value={3}>3 · Detailed</option></select></label>
        </>}
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} disabled={busy || loading} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</button>
          <button className={styles.dangerButton} disabled={busy} onClick={() => void deleteData()}>Delete my calm data</button>
        </div>
        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Link className={styles.textLink} href="/account/calm">Back to Calm</Link>
      </section>
    </CalmShell>
  );
}
