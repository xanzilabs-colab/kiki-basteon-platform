"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { BatteryCharging, Bluetooth, MapPin, Shield, ShieldAlert, Smartphone } from "lucide-react";
import { KikiTrigger, type KikiStatus } from "@/lib/kikiTrigger";

export default function EarbudTriggerCard() {
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
      if (!initialStatusRead.current) {
        setTest(current.test);
        initialStatusRead.current = true;
      }
    } catch {
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
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Bluetooth triggers</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Open this page in the Kiki Android app to arm Bluetooth media-button triggers.</p>
      </section>
    );
  }
  if (!status) {
    return <p className="rounded-xl border border-[var(--line)] p-4 text-sm" role="status">{error || "Checking this phone's trigger status…"}</p>;
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Bluetooth triggers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use a compatible headset, watch, car control, or other paired device that sends Android media-button presses.
          Verify its press pattern in the Trigger Lab before relying on it.
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <StatusRow
          ok={status.armed}
          icon={<Shield size={16} />}
          label={status.armed ? (status.test ? "Armed in test mode — no real alert is created" : "Armed for alerts") : status.wantArmed ? "Trigger service stopped; tap Arm to restart it" : "Not armed"}
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
        <span><b>Test mode first</b><br /><span className="text-[var(--muted)]">The server records a test press without dispatching a real alert.</span></span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" type="button" disabled={busy || !status} onClick={() => void (status.armed ? disarm() : arm())}>
          {busy ? "Please wait…" : status.armed ? "Disarm phone" : "Arm phone"}
        </button>
        {status.armed && (
          <button className="btn" type="button" disabled={busy} onClick={() => void arm()}>
            Apply test setting
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
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Patterns: 5 quick presses = SOS; 3 then 2 = medical; 2, 2, 2 = discreet SOS; 4 = cancel. Android and headset makers
        vary in which media events they expose. A listed or connected device is not marked ready until a practice press is detected.
      </p>
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
