"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  if (status === "linked") return "Band linked!";
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

  async function findDevice() {
    setBusy(true);
    setError("");
    failureRef.current = "";
    try {
      const next = await connectBasteonDevice();
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
      if (!response.ok) throw new Error(result.error?.replaceAll("_", " ") ?? "Could not start linking.");
      if (result.already_linked) return router.replace("/account/devices");

      setStatus("Sending a one-time code to your band…");
      await session.current.writeToken(result.token);

      // Wait for the band to confirm (status notification or the device appearing on the account)
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && mountedRef.current) {
        if (failureRef.current) throw new Error(failureRef.current);
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (failureRef.current) throw new Error(failureRef.current);
        const devices = await fetch("/api/devices/list");
        if (devices.ok && (await devices.json()).some((item: { device_id: string }) => item.device_id === deviceId)) {
          return router.replace("/account/devices");
        }
      }
      if (mountedRef.current) {
        throw new Error("The band didn't confirm linking. Keep it powered on, in link mode, and try again.");
      }
    } catch (nextError) {
      if (mountedRef.current) setError(nextError instanceof Error ? nextError.message : "Linking failed.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  if (supported === false) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Link a band</h1>
        <section className="panel p-4">
          <p className="font-medium">Bluetooth isn&apos;t available in this browser.</p>
          <p className="muted text-xs mt-2">
            Use Chrome on an Android phone, or Chrome/Edge on a computer. iPhone, Safari and Firefox aren&apos;t supported yet.
          </p>
        </section>
        <Link className="btn inline-flex items-center" href="/account/devices">Back to devices</Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <p className="eyebrow">Bluetooth setup</p>
        <h1 className="page-title mt-1">Link a band</h1>
      </div>

      <section className="panel p-4 space-y-4">
        <div className="space-y-2 text-sm">
          <p>Put your band into link mode:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Press and <b>hold</b> the button. After about 1.5 seconds you&apos;ll hear a beep. <b>Keep holding.</b></li>
            <li>At about 5 seconds you&apos;ll hear two quick beeps and the light starts double-blinking.</li>
            <li>Let go, then tap <b>Find band</b> below.</li>
          </ol>
          <p className="muted text-xs">
            Link mode lasts 5 minutes. Don&apos;t tap the button while linking, because that starts an alert countdown.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ready} onChange={(event) => setReady(event.target.checked)} />
          The light is double-blinking
        </label>

        <button
          className="btn btn-primary w-full !h-10"
          disabled={!ready || busy}
          onClick={() => void findDevice()}
        >
          {busy && !deviceId ? "Looking for your band…" : "Find band"}
        </button>

        <p className="muted text-xs">
          On Android, turn on Location before scanning. Bluetooth linking needs a secure (https) connection.
        </p>
      </section>

      {deviceId && (
        <section className="panel p-4 space-y-3">
          <p className="label">Selected band</p>
          <p className="font-medium">{deviceName}</p>
          <p className="data text-xs muted">{deviceId}</p>

          <label className="block">
            <span className="label">Nickname <span className="normal-case">(optional)</span></span>
            <input
              className="input mt-1.5"
              value={nickname}
              maxLength={40}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>

          <button className="btn btn-primary w-full !h-10" disabled={busy} onClick={() => void linkDevice()}>
            {busy ? "Linking…" : "Link this band"}
          </button>

          {status && (
            <p role="status" className={`text-xs ${failed(status) ? "text-[var(--crit)]" : "text-[var(--ok)]"}`}>
              {status}
            </p>
          )}
        </section>
      )}

      {error && (
        <section className="panel p-4 border-[var(--crit)]">
          <p role="alert" className="text-[var(--crit)] text-sm">{error}</p>
          <button className="btn mt-3" onClick={resetSession}>Try again</button>
        </section>
      )}

      <Link className="btn inline-flex items-center" href="/account/devices">Back to devices</Link>
    </div>
  );
}