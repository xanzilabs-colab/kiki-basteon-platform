"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, LockKeyhole, X } from "lucide-react";
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchCalmSettings().then((value) => { if (active) setSettings(value); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Couldn't load Calm settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setConfirmDelete(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [busy, confirmDelete]);

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

  function changeSettings(update: (current: CalmSettings) => CalmSettings) {
    setSettings(update);
    setMessage("");
    setError("");
  }

  async function deleteData() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/calm/my-data", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn't delete your Calm data.");
      setSettings(DEFAULT_CALM_SETTINGS);
      setMessage("Your saved Calm data has been deleted.");
      setConfirmDelete(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't delete your Calm data.");
    } finally {
      setBusy(false);
    }
  }

  const stop = () => { window.location.assign("/account/calm"); };
  return (
    <CalmShell title="Settings" onStop={stop} muted={muted} onMuteChange={setMuted}>
      <div className={styles.settingsPage}>
        <p className={styles.settingsIntro}>History is private and off by default. You can change or delete these choices any time.</p>

        {loading ? (
          <div role="status" aria-label="Loading Calm settings" className={styles.settingsLoading}>
            {["Privacy", "Feedback", "Breathing", "Spot the Baseline"].map((group) => <section key={group}>
              <h2>{group}</h2>
              <div className={styles.settingsList}>
                <div className={styles.settingsSkeleton}><i /><span><b /><small /></span></div>
                <div className={styles.settingsSkeleton}><i /><span><b /><small /></span></div>
              </div>
            </section>)}
          </div>
        ) : <>
          <SettingsGroup title="Privacy">
            <SettingSwitch title="Save session history" description="Short summaries only, for gentle trends. No journal notes or answers. Turning off hides history; it doesn’t delete it." checked={settings.saveHistory} disabled={busy} onChange={(checked) => changeSettings((value) => ({ ...value, saveHistory: checked }))} />
          </SettingsGroup>

          <SettingsGroup title="Feedback">
            <SettingSwitch title="Haptics" description="Gentle vibration cues where supported." checked={settings.haptics} disabled={busy} onChange={(checked) => changeSettings((value) => ({ ...value, haptics: checked }))} />
            <SettingSwitch title="Sound" description="Soft cues in Quiet mode. Header mute silences them." checked={settings.sound} disabled={busy} onChange={(checked) => changeSettings((value) => ({ ...value, sound: checked }))} />
          </SettingsGroup>

          <SettingsGroup title="Breathing">
            <SettingChoice title="Pace" description="Choose the rhythm that feels comfortable." value={settings.breathPace} options={[["gentle", "Gentle"], ["standard", "Standard"]]} disabled={busy} onChange={(value) => changeSettings((current) => ({ ...current, breathPace: value }))} />
            <SettingSwitch title="Holds" description="Optional pauses in Box breathing." checked={settings.breathHolds} disabled={busy} onChange={(checked) => changeSettings((value) => ({ ...value, breathHolds: checked }))} />
          </SettingsGroup>

          <SettingsGroup title="Spot the Baseline">
            <SettingChoice title="Level" description="Never decreases automatically." value={settings.baselineLevel} options={[[1, "Easy"], [2, "Steady"], [3, "Detailed"]]} disabled={busy} onChange={(value) => changeSettings((current) => ({ ...current, baselineLevel: value }))} />
          </SettingsGroup>

          <SettingsGroup title="Your data">
            <button className={styles.deleteRow} type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <span>Delete my Calm data</span><ChevronRight size={18} />
            </button>
          </SettingsGroup>
        </>}

        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Link className={styles.textLink} href="/account/calm">Back to Calm <ChevronRight size={16} /></Link>

        <div className={styles.settingsSaveBar}>
          <button className={styles.settingsSaveButton} disabled={busy || loading} onClick={() => void save()}>
            {busy ? "Saving…" : message === "Your Calm settings are saved." ? <><Check size={18} />Settings saved</> : "Save settings"}
          </button>
        </div>
      </div>

      {confirmDelete && <div className={styles.scrim} role="presentation" onClick={() => { if (!busy) setConfirmDelete(false); }}>
        <section className={styles.settingsDeleteSheet} role="alertdialog" aria-modal="true" aria-labelledby="delete-calm-title" aria-describedby="delete-calm-description" onClick={(event) => event.stopPropagation()}>
          <button className={styles.closeButton} type="button" disabled={busy} onClick={() => setConfirmDelete(false)} aria-label="Close delete confirmation"><X size={19} /></button>
          <span className={styles.deleteSheetIcon}><LockKeyhole size={22} /></span>
          <h2 id="delete-calm-title">Delete your Calm data?</h2>
          <p id="delete-calm-description">This permanently removes saved session history and Calm settings. Journal notes aren’t affected. This can’t be undone.</p>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.deleteConfirmButton} type="button" disabled={busy} onClick={() => void deleteData()}>{busy ? "Deleting…" : "Delete my Calm data"}</button>
          <button className={styles.keepDataButton} type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep my data</button>
        </section>
      </div>}
    </CalmShell>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.settingsGroup} aria-label={title}>
    <h2>{title}</h2>
    <div className={styles.settingsList}>{children}</div>
  </section>;
}

function SettingSwitch({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className={styles.settingsRow}>
    <span className={styles.settingsCopy}><b>{title}</b><small>{description}</small></span>
    <button className={`${styles.settingsSwitch}${checked ? ` ${styles.switchOn}` : ""}`} type="button" role="switch" aria-checked={checked} aria-label={title} disabled={disabled} onClick={() => onChange(!checked)}><i /></button>
  </div>;
}

function SettingChoice<T extends string | number>({ title, description, value, options, disabled, onChange }: { title: string; description: string; value: T; options: [T, string][]; disabled: boolean; onChange: (value: T) => void }) {
  return <div className={styles.settingsRow}>
    <span className={styles.settingsCopy}><b>{title}</b><small>{description}</small></span>
    <div className={styles.settingsSegment} role="group" aria-label={title}>
      {options.map(([option, label]) => <button key={option} type="button" disabled={disabled} aria-pressed={value === option} className={value === option ? styles.segmentActive : ""} onClick={() => onChange(option)}>{label}</button>)}
    </div>
  </div>;
}
