"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Activity, Bluetooth, CircleStop, RefreshCw, ShieldCheck } from "lucide-react";
import GestureCalibrationPanel from "@/components/GestureCalibrationPanel";
import { KikiTrigger, type TriggerEvent, type KikiStatus } from "@/lib/kikiTrigger";

const PRACTICE_WINDOW_MS = 10 * 60 * 1000;

export default function TriggerLab() {
  const native = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<KikiStatus | null>(null);
  const [practice, setPractice] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
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
      const [nextStatus, logResult] = await Promise.all([KikiTrigger.status(), KikiTrigger.getLog()]);
      if (!mounted.current) return;
      setStatus(nextStatus);
      setPractice(nextStatus.practice);
      practiceActive.current = nextStatus.practice;
      setPracticeExpiresAt(nextStatus.practiceExpiresAt ?? 0);
      setLogs(logResult.lines);
      setError("");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not read trigger diagnostics.");
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type === "raw") {
        const detail = `${new Date().toLocaleTimeString()} · ${event.tok ?? "?"} · ${event.src ?? "unknown"} · ${event.keyCode ?? "key"}${event.action ? ` · ${event.action}` : ""}${event.heldMs ? ` · held ${event.heldMs}ms` : ""}`;
        setEvents((current) => [detail, ...current].slice(0, 30));
        return;
      }
      if (event.type === "sequence") {
        setEvents((current) => [
          `${new Date().toLocaleTimeString()} · gesture ${event.signature ?? event.sequence ?? "?"} · ${event.matchStatus ?? "unknown"}${event.pattern ? ` · ${event.pattern}` : ""}`,
          ...current,
        ].slice(0, 30));
      }
    });
    return () => {
      mounted.current = false;
      void subscription.then((handle) => handle.remove());
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
          setEvents((current) => ["Practice ended; the trigger was disarmed. Review status before rearming.", ...current].slice(0, 30));
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
        <h2 className="flex items-center gap-2 font-semibold"><Activity size={18} />Practice mode</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Practice is isolated from the trigger gateway: no real alert can be sent while it is active.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void setPracticeMode(true)}>
            {practice ? "Extend Practice by 10 min" : "Start Practice · 10 min"}
          </button>
          <button className="btn" type="button" disabled={busy || !practice} onClick={() => void setPracticeMode(false)}><CircleStop size={16} />Stop Practice</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh status</button>
        </div>
        <p className="mt-2 text-sm" role="status">
          {practice
            ? `Practice is active · ${Math.max(0, Math.ceil((practiceExpiresAt - now) / 60_000))} min left. Real alerts are disabled.`
            : status?.armed
              ? status.test ? "Phone is armed in Test mode. No responder alerts are created." : "Phone is armed for live alerts."
              : "The trigger is not armed. Practice can still capture supported media events."}
        </p>
      </section>

      <GestureCalibrationPanel
        practice={practice}
        onStartPractice={() => void setPracticeMode(true)}
        status={status ?? {}}
      />

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Live input log</h2>
        {events.length
          ? <ol className="mt-3 max-h-72 space-y-2 overflow-auto text-sm" aria-live="polite">{events.map((event, index) => <li key={`${event}-${index}`} className="rounded-lg bg-[var(--surface-2)] px-3 py-2">{event}</li>)}</ol>
          : <p className="mt-2 text-sm text-[var(--muted)]">No Android media-key events observed yet.</p>}
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={14} />Kiki ignores ambiguous and unverified gestures outside Practice.</div>
      </section>

      <details className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold">Native service log</summary>
        <ol className="mt-3 space-y-1 font-mono text-xs text-[var(--muted)]">{logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol>
      </details>
      {error && <p role="alert" className="text-sm text-[var(--crit)]">{error}</p>}
    </div>
  );
}
