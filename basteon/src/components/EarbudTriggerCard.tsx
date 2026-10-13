"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BatteryCharging, Bluetooth, MapPin, Shield, ShieldAlert, Smartphone } from "lucide-react";
import { useAppDialog } from "@/components/AppDialogProvider";
import { KikiTrigger, type KikiStatus } from "@/lib/kikiTrigger";

export default function EarbudTriggerCard() {
  const { confirm } = useAppDialog();
  const native = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<KikiStatus | null>(null);
  const [test, setTest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const initialStatusRead = useRef(false);

  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      const current = await KikiTrigger.status();
      setStatus(current);
      setError("");
      if (!initialStatusRead.current) {
        setTest(current.test);
        initialStatusRead.current = true;
      }
    } catch (cause) {
      console.error("android_trigger_status_read_failed", cause);
      setError("Could not read Android trigger status. Reopen the app and try again.");
    }
  }, [native]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  async function requestDevicePermissions() {
    const bluetooth = await KikiTrigger.requestBluetooth();
    if (!bluetooth.granted) setNotice("Allow Nearby devices in Android settings to monitor Bluetooth media controls.");
    try {
      await LocalNotifications.requestPermissions();
    } catch {
      setNotice("Notifications are off. The trigger can still work, but Android may hide its foreground-service notice.");
    }
    try {
      await Geolocation.requestPermissions();
    } catch {
      setNotice("Location permission was not granted; alerts can still be sent without a location.");
    }
  }

  async function arm() {
    if (!status) return;
    if (!test && !status.liveGestureReady) {
      setNotice(status.liveGestureBlockReason ?? "Live alerts are locked. Open Trigger Lab to re-check the connected profile.");
      return;
    }
    if (!test && status.test && !(await confirm(
      "Bluetooth button patterns will create real alerts for responders. Only continue after successfully testing the exact phone and accessory. Keep another emergency option available.",
      {
        title: "Enable live Bluetooth alerts?",
        confirmLabel: "Enable live alerts",
        danger: true,
      },
    ))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestDevicePermissions();
      let token: string | undefined;
      let tokenId: string | undefined;
      if (!status.hasToken) {
        const response = await fetch("/api/trigger/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "This Android phone",
            kind: "android_shell",
            countdown_s: 10,
            discreet: true,
            allow_medical: true,
          }),
        });
        const body = await response.json().catch(() => null) as { id?: string; token?: string; error?: string } | null;
        if (!response.ok || !body?.token || !body.id) {
          throw new Error(body?.error ?? "Could not create a secure trigger token.");
        }
        token = body.token;
        tokenId = body.id;
      }
      await KikiTrigger.arm({
        baseUrl: window.location.origin,
        token,
        tokenId: tokenId ?? status.tokenId ?? undefined,
        test,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not arm this phone.");
    } finally {
      setBusy(false);
    }
  }

  async function disarm() {
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.disarm();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disarm this phone.");
    } finally {
      setBusy(false);
    }
  }

  async function removeToken() {
    setBusy(true);
    setError("");
    try {
      const { tokenId } = await KikiTrigger.forgetToken();
      if (tokenId) {
        const response = await fetch("/api/trigger/token", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: tokenId }),
        });
        const body = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "The token was removed from this phone, but server revocation failed.");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the trigger.");
    } finally {
      setBusy(false);
    }
  }

  if (!native) {
    return (
      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Bluetooth triggers</h2>
        <p className="text-sm text-[var(--muted)]">Open this page in the Kiki Android app to arm Bluetooth media-button triggers. A paired accessory can trigger Kiki only when this phone is armed.</p>
        <div className="rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-relaxed">
          <h3 className="font-semibold">Supported button patterns</h3>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            <li><b className="text-[var(--text)]">SOS:</b> 5 or more quick presses.</li>
            <li><b className="text-[var(--text)]">Medical:</b> 3 quick presses, pause, then 2.</li>
            <li><b className="text-[var(--text)]">Discreet SOS:</b> 2 quick presses, pause, 2, pause, 2.</li>
            <li><b className="text-[var(--text)]">Cancel:</b> exactly 4 quick presses during the countdown.</li>
          </ul>
        </div>
        <Link className="btn" href="/account/devices">Manage phone-connected devices</Link>
      </section>
    );
  }
  if (!status) {
    return (
      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Bluetooth triggers</h2>
        <p className="text-sm text-[var(--muted)]">Use compatible paired-device media buttons to start a test or alert. The status check is needed before arming to avoid duplicating or interrupting an existing trigger.</p>
        {error ? <p className="text-sm text-[var(--crit)]" role="alert">{error}</p> : <p className="text-sm text-[var(--muted)]" role="status">Checking this phone&apos;s trigger status…</p>}
        {error && <button className="btn" type="button" onClick={() => void refresh()}>Retry status check</button>}
        <div className="rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-relaxed">
          <h3 className="font-semibold">Button patterns</h3>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            <li><b className="text-[var(--text)]">SOS:</b> 5 or more quick presses.</li>
            <li><b className="text-[var(--text)]">Medical:</b> 3 quick presses, pause, then 2.</li>
            <li><b className="text-[var(--text)]">Discreet SOS:</b> 2 quick presses, pause, 2, pause, 2.</li>
            <li><b className="text-[var(--text)]">Cancel:</b> exactly 4 quick presses during the countdown.</li>
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Bluetooth triggers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use a compatible headset, watch, car control, or other paired device that sends Android media-button presses.
          Adding an accessory under My devices is optional for triggering; it tracks connection health and enables a guided compatibility check.
          Live alerts require a connected accessory and a verified gesture profile. Calibrate and verify it in Trigger Lab first; unmatched or ambiguous gestures are ignored.
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <StatusRow
          ok={status.armed}
          icon={<Shield size={16} />}
          label={status.armed
            ? status.test
              ? "TEST MODE: button presses are recorded, but no responder alert, countdown, or push notification is created"
              : "LIVE ALERTS: a recognized press creates a responder alert and starts its cancel countdown"
            : status.wantArmed ? "Trigger service stopped; tap Arm to restart it" : "Not armed"}
        />
        <StatusRow
          ok={status.notifications}
          icon={<Smartphone size={16} />}
          label={status.notifications ? "Android notifications are enabled" : "Notifications are off; Android may hide service status"}
        />
        <StatusRow
          ok={status.fineLocation && status.bgLocation}
          icon={<MapPin size={16} />}
          label={status.fineLocation && status.bgLocation ? "Location access is allowed in the background" : status.fineLocation ? "Allow location all the time to attach a last-known location while the app is in the background" : "Location is optional; without it, the alert has no phone location"}
        />
        <StatusRow
          ok={status.batteryUnrestricted}
          icon={<BatteryCharging size={16} />}
          label={status.batteryUnrestricted ? "Battery optimisation is disabled" : "Battery saver may stop background monitoring"}
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input className="mt-1" type="checkbox" checked={test} onChange={(event) => setTest(event.target.checked)} />
        <span><b>Test mode — no real alert</b><br /><span className="text-[var(--muted)]">When checked, Kiki only records the press. It deliberately sends no responder alert, countdown, or push notification, even though the phone may vibrate.</span></span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" disabled={busy || !status} onClick={() => void (status.armed ? disarm() : arm())}>
          {busy ? "Please wait…" : status.armed ? "Disarm phone" : "Arm phone"}
        </button>
        {status.armed && (
          <button className="btn" type="button" disabled={busy} onClick={() => void arm()}>
            {test === status.test ? "Refresh trigger" : test ? "Apply test mode" : "Apply LIVE alerts"}
          </button>
        )}
        <Link className="btn" href="/account/profile/triggers/lab">Open Trigger Lab</Link>
        {!status.batteryUnrestricted && (
          <button className="btn" type="button" onClick={() => void KikiTrigger.requestBatteryExemption()}>Battery settings</button>
        )}
        {status.fineLocation && !status.bgLocation && (
          <button className="btn" type="button" onClick={() => void KikiTrigger.openAppSettings()}>Location permissions</button>
        )}
      </div>

      {status.hasToken && (
        <button className="text-sm text-[var(--crit)] underline" type="button" disabled={busy} onClick={() => void removeToken()}>
          Remove this phone’s trigger
        </button>
      )}
      {notice && <p className="text-sm text-[var(--warn)]" role="status">{notice}</p>}
      {error && <p className="text-sm text-[var(--crit)]" role="alert">{error}</p>}
      {!test && !status.liveGestureReady && (
        <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--warn)]">
          <b>Live mode is unavailable.</b> {status.liveGestureBlockReason ?? "A connected accessory needs a fresh, verified profile with SOS and Cancel."} You can still arm Test mode while fixing this.
        </p>
      )}
      <div className="space-y-2 rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-relaxed">
        <h3 className="font-semibold">Gesture profiles</h3>
        <p className="text-[var(--muted)]">Every accessory sends its own media-event sequence. Practice captures and repeats those raw events; Kiki only matches a gesture when one verified profile produces exactly one action. Old click-count mappings are retained as legacy data but are not used for live matching.</p>
        <p className="text-[var(--muted)]">Keep Test mode on until you have verified the exact phone and accessory. Live mode is safety gated and requires both SOS and Cancel in the connected profile. A vibration alone is not proof that the server accepted an alert.</p>
      </div>
    </section>
  );
}

function StatusRow({ ok, icon, label }: { ok: boolean; icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}>{icon}</span>
      <span className="flex-1">{label}</span>
      {!ok && <ShieldAlert size={15} className="text-[var(--warn)]" aria-hidden="true" />}
    </div>
  );
}
