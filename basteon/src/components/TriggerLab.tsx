"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Activity, Bluetooth, CircleStop, RefreshCw, ShieldCheck } from "lucide-react";
import { KikiTrigger, type TriggerEvent } from "@/lib/kikiTrigger";

export default function TriggerLab() {
  const native = Capacitor.isNativePlatform();
  const [armed, setArmed] = useState(false);
  const [practice, setPractice] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const practiceTimeout = useRef<number | null>(null);
  const practiceActive = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!native || !mounted.current) return;
    try {
      const [status, result] = await Promise.all([KikiTrigger.status(), KikiTrigger.getLog()]);
      if (mounted.current) {
        setArmed(status.armed);
        setPractice(status.practice);
        setLogs(result.lines);
      }
    } catch {
      if (mounted.current) setError("Could not read trigger diagnostics.");
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type === "press") {
        setEvents((current) => [`Button press ${event.n ?? ""}`.trim(), ...current].slice(0, 15));
      } else {
        setEvents((current) => [`Sequence ${event.sequence ?? "unknown"} · ${event.pattern ?? "no match"}`, ...current].slice(0, 15));
      }
    });
    return () => {
      mounted.current = false;
      void subscription.then((handle) => handle.remove());
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (practiceActive.current) {
        practiceActive.current = false;
        void KikiTrigger.setPractice({ on: false }).catch((cause) => {
          console.error("Could not stop native Bluetooth practice mode while closing Trigger Lab.", cause);
        });
      }
    };
  }, [refresh]);

  async function setPracticeMode(on: boolean) {
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.setPractice({ on });
      practiceActive.current = on;
      setPractice(on);
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (on) {
        setEvents((current) => ["Practice mode started; real alerts are disabled for 2 minutes.", ...current].slice(0, 15));
        practiceTimeout.current = window.setTimeout(() => {
          practiceTimeout.current = null;
          if (mounted.current) {
            setPractice(false);
            setEvents((current) => ["Practice window ended. The trigger was disarmed; review status before rearming.", ...current].slice(0, 15));
          }
          practiceActive.current = false;
          void refresh();
        }, 120_000);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update practice mode.");
    } finally {
      if (!on && practiceTimeout.current !== null) {
        window.clearTimeout(practiceTimeout.current);
        practiceTimeout.current = null;
      }
      setBusy(false);
    }
  }

  if (!native) {
    return <p className="rounded-xl border border-[var(--line)] p-4 text-sm">Open Trigger Lab from the Android Kiki app. Browser sessions cannot capture system Bluetooth media-button events.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Activity size={18} />Practice mode</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Practice recognises media-button patterns locally only. It never calls the trigger gateway and cannot create or send an alert.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" disabled={busy || practice} onClick={() => void setPracticeMode(true)}>Start practice</button>
          <button className="btn" type="button" disabled={busy || !practice} onClick={() => void setPracticeMode(false)}><CircleStop size={16} />Stop practice</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh status</button>
        </div>
        <p className="mt-2 text-sm" role="status">{practice ? "Practice mode is active." : armed ? "Alerts are armed. Start practice to safely verify an input." : "The trigger is not armed. Practice mode can still test media controls."}</p>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Input log</h2>
        {events.length ? (
          <ol className="mt-3 space-y-2 text-sm" aria-live="polite">{events.map((event, index) => <li key={`${event}-${index}`} className="rounded-lg bg-[var(--surface-2)] px-3 py-2">{event}</li>)}</ol>
        ) : <p className="mt-2 text-sm text-[var(--muted)]">No button events detected yet. Pair a headset or other media-control device and try a pattern.</p>}
        <div className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={14} />Diagnostics contain event patterns and response codes only; tokens and locations are not logged.</div>
      </section>

      <details className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <summary className="cursor-pointer font-semibold">Local service diagnostics</summary>
        <ol className="mt-3 space-y-1 font-mono text-xs text-[var(--muted)]">{logs.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol>
      </details>
      {error && <p role="alert" className="text-sm text-[var(--crit)]">{error}</p>}
    </div>
  );
}
