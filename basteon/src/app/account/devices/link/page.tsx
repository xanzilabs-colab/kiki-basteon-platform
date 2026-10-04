"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bluetooth, CheckCircle2, Link2, Lock, Search, ShieldCheck } from "lucide-react";
import { connectBasteonDevice, type BasteonBleDevice } from "@/lib/ble/basteon";
import { pinErrorMessage, pinProblem } from "@/lib/devicePin";

const failed = (status: string) => status.startsWith("failed:");

const FAILURE_TEXT: Record<string, string> = {
  expired: "The link code expired. Please try again.",
  used: "That link code was already used. Please try again.",
  wrong_device: "That code was issued for a different band.",
  already_owned: "This band is linked to another account and isn't PIN-locked. Ask the owner to unlink it first.",
  active_alert: "This band has an active alert, so it can't change owner until the alert is closed.",
  pin_required: "This band is PIN-locked. Enter its PIN to continue.",
  not_found: "This band isn't registered yet.",
  bad_token: "The band couldn't read the link code. Please try again.",
  network: "The band couldn't reach the internet. Check its Wi-Fi and try again.",
  rejected: "The band rejected the link request.",
};

function humanStatus(status: string) {
  if (status === "linked") return "Band linked.";
  if (status === "linking") return "Linking your band…";
  if (status === "ready") return "Band is ready.";
  if (status === "unlocked") return "PIN accepted by the band.";
  if (status === "pin_set") return "PIN saved on the band.";
  if (status === "pin_cleared") return "PIN removed from the band.";
  if (failed(status)) {
    const reason = status.slice(7);
    return FAILURE_TEXT[reason] ?? `Linking failed: ${reason.replaceAll("_", " ")}.`;
  }
  return status;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function LinkDevicePage() {
  const router = useRouter();
  const session = useRef<BasteonBleDevice | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const failureRef = useRef("");
  const linkedRef = useRef(false);
  const mountedRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [bandLocked, setBandLocked] = useState(false);
  const [pinSupported, setPinSupported] = useState(false);
  const [nickname, setNickname] = useState("");
  const [transferRequired, setTransferRequired] = useState(false);
  const [transferPin, setTransferPin] = useState("");
  const [protect, setProtect] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    setSupported("bluetooth" in navigator);
    return () => {
      mountedRef.current = false;
      cleanup.current?.();
      session.current?.disconnect();
    };
  }, []);

  function resetSession() {
    cleanup.current?.();
    cleanup.current = null;
    session.current?.disconnect();
    session.current = null;
    failureRef.current = "";
    linkedRef.current = false;
    setDeviceId("");
    setDeviceName("");
    setBandLocked(false);
    setTransferRequired(false);
    setTransferPin("");
    setStatus("");
    setError("");
  }

  async function findDevice(showAll = false) {
    setBusy(true);
    setError("");
    failureRef.current = "";
    linkedRef.current = false;
    try {
      const next = await connectBasteonDevice({ showAll });
      cleanup.current?.();
      session.current?.disconnect();
      session.current = next;
      setDeviceName(next.name);
      setDeviceId(next.id);
      setBandLocked(next.info.locked);
      setPinSupported(next.pinSupported);
      setTransferRequired(false);
      setTransferPin("");
      setStatus(next.info.locked
        ? "Band found. It is PIN-locked."
        : "Band found. Tap “Link this device” when you're ready.");
      cleanup.current = next.onStatus((nextStatus) => {
        setStatus(humanStatus(nextStatus));
        if (nextStatus === "linked") linkedRef.current = true;
        if (failed(nextStatus)) failureRef.current = humanStatus(nextStatus);
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not find your band.");
    } finally {
      setBusy(false);
    }
  }

  async function waitForLink(id: string) {
    const deadline = Date.now() + 30_000;
    let nextPoll = Date.now() + 2_000;
    while (Date.now() < deadline && mountedRef.current) {
      if (failureRef.current) throw new Error(failureRef.current);
      if (linkedRef.current) return true;
      if (Date.now() >= nextPoll) {
        nextPoll = Date.now() + 2_000;
        const devices = await fetch("/api/devices/list");
        if (devices.ok && (await devices.json()).some((item: { device_id: string }) => item.device_id === id)) return true;
      }
      await sleep(400);
    }
    return false;
  }

  // Runs right after "linked": the band keeps BLE up ~20 s so the new owner can set a PIN.
  async function protectBand(band: BasteonBleDevice, id: string) {
    setStatus("Saving your PIN on the band…");
    await band.setPin(newPin);
    const list = await fetch("/api/devices/list");
    const row = list.ok ? ((await list.json()) as { id: string; device_id: string }[]).find((item) => item.device_id === id) : undefined;
    const saved = row
      ? await fetch(`/api/devices/${row.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: newPin }),
      })
      : null;
    if (!saved?.ok) {
      await band.clearPin().catch(() => undefined);
      throw new Error("Your band is linked, but the PIN couldn't be saved. Set it from the band's security page.");
    }
  }

  async function linkDevice() {
    const band = session.current;
    if (!band || !deviceId) return;
    setError("");
    if (protect) {
      const problem = pinProblem(newPin);
      if (problem) return setError(`New PIN: ${problem}`);
      if (newPin !== confirmPin) return setError("The new PINs don't match.");
    }
    if (transferRequired && !/^\d{4,8}$/.test(transferPin)) return setError("Enter the band's current PIN.");

    setBusy(true);
    failureRef.current = "";
    linkedRef.current = false;
    try {
      const response = await fetch("/api/devices/link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          nickname: nickname || undefined,
          pin: transferRequired ? transferPin : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error === "pin_required") {
          setTransferRequired(true);
          setStatus("This band belongs to another Kiki account. Enter its PIN to move it to your account.");
          return;
        }
        if (result.error === "bad_pin" || result.error === "pin_locked_out") setTransferPin("");
        throw new Error(pinErrorMessage(result) ?? result.error?.replaceAll("_", " ") ?? "Could not start linking.");
      }
      if (result.already_linked) return router.replace("/account/devices");

      const info = await band.readInfo();
      if (info.locked) {
        if (!result.transfer) {
          // Kiki has no PIN for this band, so the PIN on it is stale. It drops it on its next check-in,
          // which the band only does while no phone is connected.
          resetSession();
          throw new Error("This band still holds an old PIN. Keep it in link mode for about 30 seconds so it can sync with Kiki, then tap “Find Kiki device” again.");
        }
        setStatus("Unlocking the band with its PIN…");
        await band.unlock(transferPin);
      }

      setStatus("Sending a one-time code to your band…");
      await band.writeToken(result.token);

      if (!(await waitForLink(deviceId))) {
        if (mountedRef.current) throw new Error("The band didn't confirm linking. Keep it powered on, in link mode, and try again.");
        return;
      }
      setTransferPin("");
      if (protect && pinSupported) await protectBand(band, deviceId);
      if (mountedRef.current) router.replace("/account/devices");
    } catch (nextError) {
      if (mountedRef.current) {
        setError(nextError instanceof Error ? nextError.message : "Linking failed.");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  if (supported === false) {
    return (
      <div className="kiki-link-page">
        <div className="kiki-link-title">
          <span>HARDWARE GUARD</span>
          <h1>Link a Kiki device</h1>
        </div>
        <section className="kiki-link-card">
          <span className="kiki-link-icon"><Bluetooth size={24} /></span>
          <h2>Bluetooth unavailable</h2>
          <p>
            Use Chrome on an Android phone, or Chrome/Edge on a computer. iPhone, Safari and
            Firefox aren&apos;t supported yet.
          </p>
        </section>
        <Link className="btn" href="/account/devices">Back to devices</Link>
      </div>
    );
  }

  return (
    <div className="kiki-link-page">
      <div className="kiki-link-title">
        <span>HARDWARE GUARD</span>
        <h1>Link a Kiki device</h1>
        <p>Pair your Kiki Smart Clip securely with your account.</p>
      </div>

      <section className="kiki-link-card">
        <div className="kiki-link-card-head"><span className="kiki-link-icon"><Bluetooth size={24} /></span><div><span>BLUETOOTH SETUP</span><h2>Pair your Smart Clip</h2><p>Use the device&apos;s secure link mode to protect ownership.</p></div></div>
        <ol className="kiki-link-steps">
          <li><b>1</b><span>Hold the device button until you hear two short beeps and its light double-blinks.</span></li>
          <li><b>2</b><span>Confirm the device is ready, then open the browser&apos;s Bluetooth picker.</span></li>
          <li><b>3</b><span>Select your Kiki device and confirm the secure account link.</span></li>
        </ol>
        <label className="kiki-link-ready">
          <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
          <span><CheckCircle2 size={17} />The light is double-blinking</span>
        </label>
        <button
          className="btn btn-primary kiki-link-primary"
          disabled={!ready || busy}
          onClick={() => void findDevice(false)}
        >
          <Search size={17} />{busy && !deviceId ? "Looking for your device..." : "Find Kiki device"}
        </button>
        <button
          className="btn kiki-link-secondary"
          disabled={!ready || busy}
          onClick={() => void findDevice(true)}
        >
          Can&apos;t see it? Show all Bluetooth devices
        </button>
        <p className="kiki-link-caption">Link mode lasts five minutes. Close any other Bluetooth app connected to your device before searching.</p>
      </section>

      {deviceId && (
        <section className="kiki-link-card kiki-linked-device">
          <div className="kiki-link-card-head"><span className="kiki-link-icon"><Link2 size={23} /></span><div><span>DEVICE FOUND</span><h2>{deviceName}</h2><p className="kiki-device-id">{deviceId}</p></div></div>
          <label className="kiki-link-nickname">
            <span>DEVICE NICKNAME <em>Optional</em></span>
            <input
              className="input"
              value={nickname}
              maxLength={40}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="My Kiki Smart Clip"
            />
          </label>
          {bandLocked && !transferRequired && (
            <p className="kiki-link-caption"><Lock size={14} /> This band is PIN-locked. If it belongs to someone else you&apos;ll need its PIN.</p>
          )}
          {transferRequired && (
            <label className="kiki-link-nickname">
              <span>CURRENT BAND PIN</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={transferPin}
                maxLength={8}
                onChange={(e) => setTransferPin(e.target.value.replace(/\D/g, ""))}
              />
              <em className="kiki-link-caption">The previous owner will be notified. A band with an active alert can&apos;t be transferred.</em>
            </label>
          )}
          {pinSupported && (
            <>
              <label className="kiki-link-ready">
                <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
                <span><Lock size={17} />Protect this band with a PIN</span>
              </label>
              {protect && (
                <div className="kiki-link-nickname">
                  <label>
                    <span>NEW PIN <em>4–8 digits</em></span>
                    <input className="input" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} maxLength={8} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <label>
                    <span>CONFIRM PIN</span>
                    <input className="input" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} maxLength={8} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <em className="kiki-link-caption">Without the PIN nobody can move this band to another account. The panic button always works.</em>
                </div>
              )}
            </>
          )}
          <button
            className="btn btn-primary kiki-link-primary"
            disabled={busy}
            onClick={() => void linkDevice()}
          >
            <ShieldCheck size={17} />{busy ? "Linking securely..." : transferRequired ? "Transfer this device to me" : "Link this device"}
          </button>
          {status && <p role="status" className={`kiki-link-status ${failed(status) ? "is-error" : ""}`}>{status}</p>}
        </section>
      )}

      {error && (
        <section className="kiki-link-card kiki-link-error">
          <p role="alert">{error}</p>
          <button className="btn kiki-link-secondary" onClick={resetSession}>Try again</button>
        </section>
      )}

      <Link className="kiki-link-back" href="/account/devices">Back to devices</Link>
    </div>
  );
}