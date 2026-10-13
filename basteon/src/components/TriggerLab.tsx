"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Activity, Bluetooth, CircleStop, RefreshCw, ShieldCheck } from "lucide-react";
import { KikiTrigger, type TriggerEvent, type UniversalTriggerConfig } from "@/lib/kikiTrigger";

type UniversalAction = "sos" | "medical" | "duress" | "cancel";

const ACTIONS: { id: UniversalAction; title: string; description: string }[] = [
  { id: "sos", title: "SOS", description: "Total click count in a sequence for an SOS alert." },
  { id: "medical", title: "Medical alert", description: "Total click count in a sequence for a medical alert." },
  { id: "duress", title: "Discreet SOS", description: "Total click count in a sequence for a discreet SOS." },
  { id: "cancel", title: "Cancel countdown", description: "Total click count in a sequence to cancel an alert countdown." },
];

const EMPTY_CONFIG: UniversalTriggerConfig = {
  enabled: false,
  sos: null,
  medical: null,
  duress: null,
  cancel: null,
};

const PRACTICE_WINDOW_MS = 10 * 60 * 1000;

function clickWord(count: number) {
  return `${count} ${count === 1 ? "click" : "clicks"}`;
}

function actionName(action: string | null | undefined) {
  switch (action) {
    case "sos": return "SOS";
    case "medical": return "medical alert";
    case "duress": return "discreet SOS";
    case "cancel": return "countdown cancel";
    default: return "no match";
  }
}

function sequenceClickCount(sequence: string | undefined, fallback = 0) {
  if (!sequence) return fallback;
  return sequence.split("-").reduce((sum, burst) => sum + (Number(burst) || 0), 0);
}

export default function TriggerLab() {
  const native = Capacitor.isNativePlatform();
  const [armed, setArmed] = useState(false);
  const [practice, setPractice] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [universal, setUniversal] = useState<UniversalTriggerConfig>(EMPTY_CONFIG);
  const [universalBusy, setUniversalBusy] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [lastSequence, setLastSequence] = useState<{ clicks: number; sequence: string; origin: string } | null>(null);
  const [practiceExpiresAt, setPracticeExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [captureTarget, setCaptureTarget] = useState<UniversalAction | null>(null);
  const [captureCandidate, setCaptureCandidate] = useState<{ action: UniversalAction; clicks: number } | null>(null);
  const [captureMessage, setCaptureMessage] = useState("");
  const practiceTimeout = useRef<number | null>(null);
  const practiceActive = useRef(false);
  const captureTargetRef = useRef<UniversalAction | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!native || !mounted.current) return;
    try {
      const [status, result, config] = await Promise.all([
        KikiTrigger.status(),
        KikiTrigger.getLog(),
        KikiTrigger.getTriggerConfig(),
      ]);
      if (mounted.current) {
        setArmed(status.armed);
        setPractice(status.practice);
        practiceActive.current = status.practice;
        setPracticeExpiresAt(status.practiceExpiresAt ?? 0);
        setLogs(result.lines);
        setUniversal(config);
      }
    } catch {
      if (mounted.current) setError("Could not read trigger diagnostics or saved click settings.");
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type === "press") {
        setTapCount(event.n ?? 0);
        return;
      }

      setTapCount(0);
      const clicks = event.presses ?? sequenceClickCount(event.sequence);
      if (event.sequence) {
        setLastSequence({
          clicks,
          sequence: event.sequence,
          origin: event.origin ?? "unknown",
        });
      }
      setEvents((current) => [
        `${event.sequence ?? "unknown"} · ${clickWord(clicks)} · ${actionName(event.pattern)} · ${event.origin === "media_button" ? "key event" : event.origin === "media_session" ? "media session" : "source unknown"}`,
        ...current,
      ].slice(0, 15));

      const target = captureTargetRef.current;
      if (!target) return;
      captureTargetRef.current = null;
      setCaptureTarget(null);
      if (!event.sequence) {
        setCaptureCandidate(null);
        setCaptureMessage("No complete click sequence was detected. Try again and pause after your final click.");
        return;
      }
      if (clicks < 1 || clicks > 20) {
        setCaptureCandidate(null);
        setCaptureMessage("That count is outside the supported range. Capture a sequence containing 1–20 clicks.");
        return;
      }
      setCaptureCandidate({ action: target, clicks });
      setCaptureMessage(`Detected ${clickWord(clicks)} (${event.sequence}) for ${actionName(target)}. Choose Set to save it.`);
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

  useEffect(() => {
    if (!practice) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void KikiTrigger.status().then((status) => {
        if (!mounted.current) return;
        setArmed(status.armed);
        setPractice(status.practice);
        practiceActive.current = status.practice;
        setPracticeExpiresAt(status.practiceExpiresAt ?? 0);
      }).catch((cause: unknown) => {
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not refresh Practice status.");
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [practice]);

  async function setPracticeMode(on: boolean) {
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.setPractice({ on });
      practiceActive.current = on;
      setPractice(on);
      if (!on) {
        captureTargetRef.current = null;
        setCaptureTarget(null);
        setCaptureCandidate(null);
        setCaptureMessage("");
      }
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (on) {
        const expiresAt = Date.now() + PRACTICE_WINDOW_MS;
        setPracticeExpiresAt(expiresAt);
        setEvents((current) => ["Practice mode started; real alerts are disabled for 10 minutes.", ...current].slice(0, 15));
        practiceTimeout.current = window.setTimeout(() => {
          practiceTimeout.current = null;
          if (mounted.current) {
            setPractice(false);
            setPracticeExpiresAt(0);
            captureTargetRef.current = null;
            setCaptureTarget(null);
            setCaptureCandidate(null);
            setCaptureMessage("");
            setEvents((current) => ["Practice window ended. The trigger was disarmed; review status before rearming.", ...current].slice(0, 15));
          }
          practiceActive.current = false;
          void refresh();
        }, PRACTICE_WINDOW_MS);
      } else {
        setPracticeExpiresAt(0);
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

  function beginCapture(action: UniversalAction) {
    setError("");
    setCaptureCandidate(null);
    if (!practice) {
      setCaptureMessage("Start practice mode first. It blocks real alerts while you capture and test clicks.");
      return;
    }
    captureTargetRef.current = action;
    setCaptureTarget(action);
    setCaptureMessage(`Tap your earbud control the desired number of times for ${actionName(action)}, then pause for about one second. Short pauses between clicks are okay.`);
  }

  async function saveConfig(next: UniversalTriggerConfig, message: string) {
    setUniversalBusy(true);
    setError("");
    try {
      await KikiTrigger.setTriggerConfig(next);
      setUniversal(next);
      setCaptureCandidate(null);
      setCaptureMessage(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this phone’s custom click settings.");
    } finally {
      setUniversalBusy(false);
    }
  }

  async function setUniversalMode(enabled: boolean) {
    if (enabled && !practice) {
      setCaptureMessage("Start practice mode before changing custom trigger settings.");
      return;
    }
    if (enabled && !ACTIONS.some(({ id }) => universal[id] !== null)) {
      setCaptureMessage("Capture and Set at least one action before turning on universal mode.");
      return;
    }
    await saveConfig({ ...universal, enabled }, enabled
      ? "Universal click mode is saved on this phone."
      : "Standard fixed patterns are active again.");
  }

  async function setCapturedAction() {
    if (!captureCandidate) return;
    const conflict = ACTIONS.find(({ id }) => id !== captureCandidate.action && universal[id] === captureCandidate.clicks);
    if (conflict) {
      setCaptureMessage(`${clickWord(captureCandidate.clicks)} is already assigned to ${conflict.title}. Capture a different count so each action is unambiguous.`);
      return;
    }
    await saveConfig({
      ...universal,
      [captureCandidate.action]: captureCandidate.clicks,
    }, `Saved ${clickWord(captureCandidate.clicks)} for ${actionName(captureCandidate.action)}.`);
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
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void setPracticeMode(true)}>{practice ? "Extend practice by 10 min" : "Start practice · 10 min"}</button>
          <button className="btn" type="button" disabled={busy || !practice} onClick={() => void setPracticeMode(false)}><CircleStop size={16} />Stop practice</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh status</button>
        </div>
        <p className="mt-2 text-sm" role="status">{practice ? `Practice mode is active · ${Math.max(0, Math.ceil((practiceExpiresAt - now) / 60_000))} min left. Real alerts are disabled.` : armed ? "Alerts are armed. Start practice to safely verify an input." : "The trigger is not armed. Practice mode can still test media controls."}</p>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Universal click setup</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">See how many media-button clicks your earbuds actually send, then assign a different click count to each action. The settings are saved securely on this phone.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={universal.enabled} disabled={universalBusy} onChange={(event) => void setUniversalMode(event.target.checked)} />
            Use my click counts
          </label>
        </div>
        {!universal.enabled && <p className="mt-2 text-xs text-[var(--muted)]">To turn this on: start Practice, Capture and Set at least one action, then check this box.</p>}

        <div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4 text-center" role="status" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Clicks detected in current sequence</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums">{tapCount || lastSequence?.clicks || 0}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{tapCount
            ? `${clickWord(tapCount)} so far · count resets about one second after the last press`
            : lastSequence
              ? `Last: ${clickWord(lastSequence.clicks)} (${lastSequence.sequence}) · ${lastSequence.origin === "media_button" ? "key event" : lastSequence.origin === "media_session" ? "media session" : "source unknown"}`
              : "Waiting for an earbud media-button press"}</p>
        </div>

        <div className="mt-4 space-y-2">
          {ACTIONS.map(({ id, title, description }) => (
            <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="text-xs text-[var(--muted)]">{description}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--accent)]">{universal[id] === null ? "Not set" : `Set to ${clickWord(universal[id]!)}`}</p>
              </div>
              <button className="btn" type="button" disabled={universalBusy || !practice} onClick={() => beginCapture(id)}>
                {captureTarget === id ? "Listening…" : "Capture"}
              </button>
            </div>
          ))}
        </div>

        {captureCandidate && (
          <button className="btn btn-primary mt-3 w-full" type="button" disabled={universalBusy} onClick={() => void setCapturedAction()}>
            Set {clickWord(captureCandidate.clicks)} for {actionName(captureCandidate.action)}
          </button>
        )}
        {captureMessage && <p className="mt-3 text-sm" role="status">{captureMessage}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn" type="button" disabled={universalBusy || !universal.enabled} onClick={() => void setUniversalMode(false)}>Use standard fixed patterns</button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Clicks can be grouped by short pauses; the custom action uses the total count in the sequence. Pause about one second after the final click. Use a different count for each action. Universal mode replaces the standard rhythms; unassigned counts do nothing. Keep Practice active while configuring so no real alerts can be sent.
        </p>
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
