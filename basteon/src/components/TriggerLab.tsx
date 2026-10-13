"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { CircleStop, RefreshCw } from "lucide-react";
import GestureCalibrationPanel from "@/components/GestureCalibrationPanel";
import { KikiTrigger, type KikiStatus } from "@/lib/kikiTrigger";

const PRACTICE_WINDOW_MS = 10 * 60 * 1000;

export default function TriggerLab() {
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

  async function setPracticeMode(on: boolean) {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Practice mode.");
    } finally {
      setBusy(false);
    }
  }

  if (!native) {
    return <p className="rounded-xl border border-[var(--line)] p-4 text-sm">Open Trigger Lab in the Kiki Android app. A browser cannot capture Android media-button events.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Safe setup</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Practice temporarily turns off live alerts. Use it to teach Kiki your button patterns.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void setPracticeMode(true)}>
            {practice ? "Extend Practice by 10 min" : "Start Practice · 10 min"}
          </button>
          <button className="btn" type="button" disabled={busy || !practice} onClick={() => void setPracticeMode(false)}><CircleStop size={16} />Stop Practice</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh status</button>
        </div>
        <p className="mt-2 text-sm" role="status">
          {practice
            ? `Practice is on · ${Math.max(0, Math.ceil((practiceExpiresAt - now) / 60_000))} min left. No real alerts can be sent.`
            : status?.armed
              ? status.test ? "Phone is armed safely in Test mode." : "Phone is armed for live alerts."
              : "Practice can be used to set up buttons before arming."}
        </p>
      </section>

      <GestureCalibrationPanel
        practice={practice}
        onStartPractice={() => void setPracticeMode(true)}
        status={status ?? {}}
      />

      {error && <p role="alert" className="text-sm text-[var(--crit)]">{error}</p>}
    </div>
  );
}
