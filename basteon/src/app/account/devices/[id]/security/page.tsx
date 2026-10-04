"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bluetooth, Lock, LockOpen, ShieldCheck, Trash2 } from "lucide-react";
import { connectBasteonDevice, type BasteonBleDevice } from "@/lib/ble/basteon";
import { pinErrorMessage, pinProblem } from "@/lib/devicePin";
import { createClient } from "@/lib/supabase/client";
import type { Device } from "@/lib/types";

type SecurityDevice = Pick<Device, "id" | "device_id" | "device_name" | "pin_locked" | "pin_set_at" | "band_pin_locked" | "band_lock_reported_at">;

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 8);

async function apiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return pinErrorMessage(body) ?? (typeof body.error === "string" ? body.error.replaceAll("_", " ") : fallback);
}

function PinInput({ label, value, onChange, autoComplete = "off" }: { label: string; value: string; onChange(value: string): void; autoComplete?: string }) {
  return (
    <label>
      {label}
      <input className="input" type="password" inputMode="numeric" autoComplete={autoComplete} maxLength={8} value={value} onChange={(event) => onChange(digits(event.target.value))} />
    </label>
  );
}

export default function DeviceSecurityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [device, setDevice] = useState<SecurityDevice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [removePin, setRemovePin] = useState("");
  const [unlinkPin, setUnlinkPin] = useState("");

  const refresh = useCallback(async () => {
    const { data } = await createClient()
      .from("devices")
      .select("id,device_id,device_name,pin_locked,pin_set_at,band_pin_locked,band_lock_reported_at")
      .eq("id", id)
      .maybeSingle();
    setDevice((data as SecurityDevice | null) ?? null);
    setLoaded(true);
  }, [id]);

  useEffect(() => { void refresh(); }, [refresh]);

  function reset(nextMessage: string) {
    setCurrentPin(""); setNewPin(""); setConfirmPin(""); setRemovePin(""); setUnlinkPin("");
    setMessage(nextMessage);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Something went wrong."); } finally { setBusy(false); }
  }

  function checkNewPin() {
    const problem = pinProblem(newPin);
    if (problem) throw new Error(`New PIN: ${problem}`);
    if (newPin !== confirmPin) throw new Error("The new PINs don't match.");
  }

  async function connectThisBand(target: SecurityDevice): Promise<BasteonBleDevice> {
    setMessage("Hold the band button for 5 seconds (two beeps), then choose it in the Bluetooth picker.");
    const band = await connectBasteonDevice();
    if (band.id !== target.device_id) {
      band.disconnect();
      throw new Error("That's a different band. Choose the one with this device ID.");
    }
    if (!band.pinSupported) {
      band.disconnect();
      throw new Error("This band's firmware doesn't support PIN lock. Update it to v2.6 or newer.");
    }
    return band;
  }

  const setPin = () => run(async () => {
    if (!device) return;
    checkNewPin();
    const band = await connectThisBand(device);
    try {
      if (band.info.locked) throw new Error("The band still holds an old PIN. Disconnect, wait about 30 seconds in link mode so it can sync, then try again.");
      setMessage("Saving the PIN on the band…");
      await band.setPin(newPin);
      const response = await fetch(`/api/devices/${device.id}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: newPin }) });
      if (!response.ok) {
        const text = await apiError(response, "Could not save the PIN.");
        await band.clearPin().catch(() => undefined);
        throw new Error(text);
      }
      reset("PIN lock is on. Keep your PIN private; Kiki staff will never ask for it.");
    } finally {
      band.disconnect();
      await refresh();
    }
  });

  const changePin = () => run(async () => {
    if (!device) return;
    if (!/^\d{4,8}$/.test(currentPin)) throw new Error("Enter your current PIN.");
    checkNewPin();
    const band = await connectThisBand(device);
    try {
      const previous = band.info;
      setMessage("Unlocking the band…");
      await band.unlock(currentPin);
      await band.setPin(newPin);
      const response = await fetch(`/api/devices/${device.id}/pin`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }) });
      if (!response.ok) {
        const text = await apiError(response, "Could not change the PIN.");
        // Put the band back the way it was so it keeps matching the server.
        if (previous.locked && previous.salt) await band.setPin(currentPin, previous.salt).catch(() => undefined);
        else await band.clearPin().catch(() => undefined);
        throw new Error(text);
      }
      reset("PIN changed on the band and in your account.");
    } finally {
      band.disconnect();
      await refresh();
    }
  });

  const deletePin = () => run(async () => {
    if (!device) return;
    if (!/^\d{4,8}$/.test(removePin)) throw new Error("Enter your current PIN.");
    const response = await fetch(`/api/devices/${device.id}/pin`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: removePin }) });
    if (!response.ok) { setRemovePin(""); throw new Error(await apiError(response, "Could not remove the PIN.")); }
    reset("PIN lock removed. The band clears its PIN the next time it checks in online (within a few minutes).");
    await refresh();
  });

  const unlink = () => run(async () => {
    if (!device) return;
    if (device.pin_locked && !/^\d{4,8}$/.test(unlinkPin)) throw new Error("Enter the band PIN to unlink it.");
    if (!window.confirm(`Unlink ${device.device_name}? Its alerts will no longer reach your account.`)) return;
    const response = await fetch(`/api/devices/${device.id}/unlink`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(device.pin_locked ? { pin: unlinkPin } : {}) });
    if (!response.ok) { setUnlinkPin(""); throw new Error(await apiError(response, "Could not unlink the device.")); }
    router.replace("/account/devices");
  });

  if (!loaded) return <div className="kiki-setting-page"><p>Loading…</p></div>;
  if (!device) {
    return <div className="kiki-setting-page"><header><span>MY DEVICES</span><h1>Device not found</h1></header><Link className="btn" href="/account/devices">Back to devices</Link></div>;
  }

  const mismatch = device.pin_locked && device.band_pin_locked === false;

  return (
    <div className="kiki-setting-page">
      <header>
        <span>MY DEVICES</span>
        <h1>Band security</h1>
        <p>{device.device_name} · <span className="data">{device.device_id}</span></p>
      </header>

      <section>
        <div className="kiki-security-icon">{device.pin_locked ? <Lock size={24} /> : <LockOpen size={24} />}</div>
        <h2>{device.pin_locked ? "PIN lock is on" : "PIN lock is off"}</h2>
        <p>
          {device.pin_locked
            ? `Set ${device.pin_set_at ? new Date(device.pin_set_at).toLocaleDateString() : "previously"}. Nobody can unlink this band or move it to another account without the PIN, and never while an alert is active.`
            : "Nobody else can link this band while it's yours, but without a PIN it can only change hands after you unlink it. Add a PIN to protect unlinking and allow PIN-checked transfers."}
        </p>
        <p className="muted">The panic button always works, with or without a PIN.</p>
        {mismatch && <p role="status">The band reported that it has no PIN. Re-sync it below by entering your PIN as both the current and new PIN.</p>}
      </section>

      {!device.pin_locked ? (
        <section>
          <h2>Set a PIN</h2>
          <p><Bluetooth size={14} /> Keep the band close; you&apos;ll put it in link mode to save the PIN on it.</p>
          <PinInput label="New PIN (4–8 digits)" value={newPin} onChange={setNewPin} autoComplete="new-password" />
          <PinInput label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} autoComplete="new-password" />
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void setPin()}><ShieldCheck size={16} />Connect band and set PIN</button>
        </section>
      ) : (
        <>
          <section>
            <h2>Change PIN</h2>
            <p><Bluetooth size={14} /> Keep the band close; you&apos;ll put it in link mode to update it.</p>
            <PinInput label="Current PIN" value={currentPin} onChange={setCurrentPin} />
            <PinInput label="New PIN (4–8 digits)" value={newPin} onChange={setNewPin} autoComplete="new-password" />
            <PinInput label="Confirm new PIN" value={confirmPin} onChange={setConfirmPin} autoComplete="new-password" />
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void changePin()}><ShieldCheck size={16} />Connect band and change PIN</button>
          </section>
          <section>
            <h2>Remove PIN</h2>
            <p>The band doesn&apos;t need to be nearby. It drops its PIN the next time it checks in online.</p>
            <PinInput label="Current PIN" value={removePin} onChange={setRemovePin} />
            <button className="btn" type="button" disabled={busy} onClick={() => void deletePin()}><LockOpen size={16} />Remove PIN</button>
          </section>
        </>
      )}

      <section id="unlink">
        <h2>Unlink band</h2>
        <p>Unlinking removes the band from your account{device.pin_locked ? " and requires its PIN" : ""}. A band with an active alert can&apos;t be unlinked.</p>
        {device.pin_locked && <PinInput label="Band PIN" value={unlinkPin} onChange={setUnlinkPin} />}
        <button className="btn" type="button" disabled={busy} onClick={() => void unlink()}><Trash2 size={16} />Unlink band</button>
      </section>

      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="text-[var(--crit)]">{error}</p>}
      <Link className="kiki-link-back" href="/account/devices">Back to devices</Link>
    </div>
  );
}
