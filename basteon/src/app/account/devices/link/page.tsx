"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bluetooth, CheckCircle2, Link2, Search, ShieldCheck } from "lucide-react";
import { connectBasteonDevice, type BasteonBleDevice } from "@/lib/ble/basteon";

const failed = (status: string) => status.startsWith("failed:");

const FAILURE_TEXT: Record<string, string> = {
  expired: "The link code expired. Please try again.",
  used: "That link code was already used. Please try again.",
  wrong_device: "That code was issued for a different band.",
  already_owned: "This band is already linked to another account.",
  not_found: "This band isn't registered yet.",
  bad_token: "The band couldn't read the link code. Please try again.",
  network: "The band couldn't reach the internet. Check its Wi-Fi and try again.",
  rejected: "The band rejected the link request.",
};

function humanStatus(status: string) {
  if (status === "linked") return "Band linked.";
  if (status === "linking") return "Linking your band…";
  if (status === "ready") return "Band is ready.";
  if (failed(status)) {
    const reason = status.slice(7);
    return FAILURE_TEXT[reason] ?? `Linking failed: ${reason.replaceAll("_", " ")}.`;
  }
  return status;
}

export default function LinkDevicePage() {
  const router = useRouter();
  const session = useRef<BasteonBleDevice | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const failureRef = useRef("");
  const mountedRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [nickname, setNickname] = useState("");
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
    setDeviceId("");
    setDeviceName("");
    setStatus("");
    setError("");
  }

  async function findDevice(showAll = false) {
    setBusy(true);
    setError("");
    failureRef.current = "";
    try {
      const next = await connectBasteonDevice({ showAll });
      cleanup.current?.();
      session.current?.disconnect();
      session.current = next;
      setDeviceName(next.name);
      setDeviceId(next.id);
      setStatus("Band found. Tap “Link this band” when you're ready.");
      cleanup.current = next.onStatus((nextStatus) => {
        setStatus(humanStatus(nextStatus));
        if (failed(nextStatus)) failureRef.current = humanStatus(nextStatus);
        if (nextStatus === "linked") {
          window.setTimeout(() => {
            if (mountedRef.current) router.replace("/account/devices");
          }, 900);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not find your band.");
    } finally {
      setBusy(false);
    }
  }

  async function linkDevice() {
    if (!session.current || !deviceId) return;
    setBusy(true);
    setError("");
    failureRef.current = "";
    try {
      const response = await fetch("/api/devices/link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, nickname: nickname || undefined }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.replaceAll("_", " ") ?? "Could not start linking.");
      }
      if (result.already_linked) return router.replace("/account/devices");

      setStatus("Sending a one-time code to your band…");
      await session.current.writeToken(result.token);

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && mountedRef.current) {
        if (failureRef.current) throw new Error(failureRef.current);
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (failureRef.current) throw new Error(failureRef.current);
        const devices = await fetch("/api/devices/list");
        if (
          devices.ok &&
          (await devices.json()).some(
            (item: { device_id: string }) => item.device_id === deviceId,
          )
        ) {
          return router.replace("/account/devices");
        }
      }
      if (mountedRef.current) {
        throw new Error(
          "The band didn't confirm linking. Keep it powered on, in link mode, and try again.",
        );
      }
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
          <button
            className="btn btn-primary kiki-link-primary"
            disabled={busy}
            onClick={() => void linkDevice()}
          >
            <ShieldCheck size={17} />{busy ? "Linking securely..." : "Link this device"}
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