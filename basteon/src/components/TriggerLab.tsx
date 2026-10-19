"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { CircleStop, RefreshCw } from "lucide-react";
import GestureCalibrationPanel from "@/components/GestureCalibrationPanel";
import { KikiTrigger, type KikiStatus } from "@/lib/kikiTrigger";
import styles from "@/app/account/profile/triggers/lab/triggerLab.module.css";

const PRACTICE_WINDOW_MS = 10 * 60 * 1000;

export default function TriggerLab({ requestedDeviceRef = "" }: { requestedDeviceRef?: string }) {
  const native = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<KikiStatus | null>(null);
  const [practice, setPractice] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [practiceExpiresAt, setPracticeExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const practiceTimeout = useRef<number | null>(null);
  const practiceActive = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!native || !mounted.current) return;
    try {
      const nextStatus = await KikiTrigger.status();
      if (!mounted.current) return;
      setStatus(nextStatus);
      setPractice(nextStatus.practice);
      practiceActive.current = nextStatus.practice;
      setPracticeExpiresAt(nextStatus.practiceExpiresAt ?? 0);
      setError("");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not read trigger diagnostics.");
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (practiceActive.current) {
        practiceActive.current = false;
        void KikiTrigger.setPractice({ on: false }).catch((cause) => {
          console.error("Could not stop native Bluetooth Practice while closing Trigger Lab.", cause);
        });
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!practice) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [practice, refresh]);

  async function setPracticeMode(on: boolean): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.setPractice({ on });
      practiceActive.current = on;
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (on) {
        const expiresAt = Date.now() + PRACTICE_WINDOW_MS;
        setPracticeExpiresAt(expiresAt);
        practiceTimeout.current = window.setTimeout(() => {
          practiceTimeout.current = null;
          practiceActive.current = false;
          setPractice(false);
          setPracticeExpiresAt(0);
          void refresh();
        }, PRACTICE_WINDOW_MS);
      } else {
        setPracticeExpiresAt(0);
      }
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Practice mode.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!native) {
    return <p className={styles.card}>Open Trigger Lab in the Kiki Android app. A browser cannot capture Android media-button events.</p>;
  }

  const remainingMs = Math.max(0, practiceExpiresAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const practiceTime = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  return (
    <div className={styles.lab}>
      <section className={styles.practice} aria-label="Practice safety status">
        <div className={styles.practiceRow}>
          <span className={`${styles.practiceDot} ${practice ? "" : styles.practiceDotOff}`} aria-hidden="true" />
          <b className={styles.practiceTitle}>{practice ? "Practice is on" : "Practice is off"}</b>
          {practice && <span className={styles.practiceTime} aria-label={`${Math.floor(remainingSeconds / 60)} minutes remaining`}>{practiceTime} left</span>}
        </div>
        <p className={styles.practiceCopy}>
          {practice
            ? "No real alerts can be sent while you set up."
            : "Start Practice before setup. Live alerts pause while Practice is on."}
        </p>
        <div className={`${styles.buttonRow} ${styles.practiceActions}`}>
          <button className={styles.practiceChip} type="button" disabled={busy} onClick={() => void setPracticeMode(true)}>
            {practice ? "Extend 10 min" : "Start Practice · 10 min"}
          </button>
          <button className={styles.practiceChip} type="button" disabled={busy || !practice} onClick={() => void setPracticeMode(false)}>
            <CircleStop size={14} />Stop
          </button>
          <button className={styles.practiceChip} type="button" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={14} />Refresh
          </button>
        </div>
      </section>

      <GestureCalibrationPanel
        practice={practice}
        onStartPractice={() => setPracticeMode(true)}
        status={status ?? {}}
        requestedDeviceRef={requestedDeviceRef}
      />
      {error && <p className={styles.message + " " + styles.messageError} role="alert">{error}</p>}
    </div>
  );
}
