"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Bluetooth, CheckCircle2, Headphones, Link2, RefreshCw, Trash2 } from "lucide-react";
import {
  KikiTrigger,
  type EverydayDevice,
  type EverydayDeviceKind,
  type PairedBluetoothDevice,
  type TriggerEvent,
} from "@/lib/kikiTrigger";

const KIND_NAMES: Record<EverydayDeviceKind, string> = {
  earbuds: "Earbuds / headset",
  watch: "Watch",
  ring: "Ring",
  car: "Car controls",
  speaker: "Speaker",
  wired: "Wired headphones",
  other: "Other media device",
};

function statusText(status: EverydayDevice["status"]) {
  switch (status) {
    case "connected": return "Connected";
    case "disconnected": return "Paired · not connected";
    case "unpaired": return "Pair again";
    case "bluetooth_off": return "Bluetooth is off";
    case "permission_needed": return "Bluetooth permission needed";
    case "untracked": return "Connection not tracked";
  }
}

export default function EverydayDevicesCard() {
  const native = Capacitor.isNativePlatform();
  const [devices, setDevices] = useState<EverydayDevice[]>([]);
  const [paired, setPaired] = useState<PairedBluetoothDevice[]>([]);
  const [selected, setSelected] = useState<PairedBluetoothDevice | null>(null);
  const [kind, setKind] = useState<EverydayDeviceKind>("earbuds");
  const [name, setName] = useState("");
  const [notifyDrop, setNotifyDrop] = useState(true);
  const [practiceRef, setPracticeRef] = useState<string | null>(null);
  const [lastPractice, setLastPractice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const practiceTimeout = useRef<number | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      const [saved, bonded, status] = await Promise.all([KikiTrigger.devices(), KikiTrigger.pairedDevices(), KikiTrigger.status()]);
      setDevices(saved.devices);
      setPaired(bonded.devices);
      setNotifyDrop(status.notifyDrop);
    } catch {
      setError("Could not read paired devices. Check Bluetooth permission and try again.");
    }
  }, [native]);

  useEffect(() => {
    void refresh();
    mounted.current = true;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const subscription = KikiTrigger.addListener("devices", ({ devices: current }) => setDevices(current));
    return () => {
      window.removeEventListener("focus", onFocus);
      void subscription.then((handle) => handle.remove());
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type !== "sequence") return;
      const detected = event.pattern ?? (event.sequence ? `Practice sequence ${event.sequence}` : "Practice input detected");
      setLastPractice(detected);
      if (!practiceRef || !event.pattern) return;
      const current = devices.find((device) => device.ref === practiceRef);
      if (current?.status !== "connected") return;
      void KikiTrigger.markVerified({ ref: practiceRef })
        .then(() => {
          setLastPractice(`${KIND_NAMES[current.kind]} practice press detected`);
          setPracticeRef(null);
          if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
          return KikiTrigger.setPractice({ on: false });
        })
        .then(refresh)
        .catch(() => setError("The practice press was detected, but device verification could not be saved."));
    });
    return () => { void subscription.then((handle) => handle.remove()); };
  }, [devices, practiceRef, refresh]);

  async function pairDevice() {
    setError("");
    setBusy(true);
    try {
      const permission = await KikiTrigger.requestBluetooth();
      if (!permission.granted) throw new Error("Allow Nearby devices permission before choosing a paired device.");
      await KikiTrigger.openBluetoothSettings();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open Bluetooth settings.");
    } finally {
      setBusy(false);
    }
  }

  function choose(device: PairedBluetoothDevice) {
    setSelected(device);
    setKind(device.kind);
    setName(`${KIND_NAMES[device.kind]} device`);
  }

  async function addDevice(deviceKind: EverydayDeviceKind, bluetoothDevice?: PairedBluetoothDevice) {
    const label = name.trim() || (deviceKind === "wired" ? "Wired headphones" : `${KIND_NAMES[deviceKind]} device`);
    setBusy(true);
    setError("");
    try {
      await KikiTrigger.registerDevice({
        ref: crypto.randomUUID(),
        kind: deviceKind,
        name: label,
        address: bluetoothDevice?.address,
        btName: bluetoothDevice?.btName,
      });
      setSelected(null);
      setName("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this device.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(device: EverydayDevice) {
    setBusy(true);
    setError("");
    try {
      if (practiceRef === device.ref) await stopPractice();
      await KikiTrigger.removeDevice({ ref: device.ref });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this device.");
    } finally {
      setBusy(false);
    }
  }

  async function startPractice(device: EverydayDevice) {
    if (device.status !== "connected") {
      setError("Connect this device first, then run its practice check.");
      return;
    }
    const otherConnected = devices.some((candidate) => candidate.ref !== device.ref && candidate.status === "connected");
    if (otherConnected) {
      setError("Disconnect other registered media devices for the practice check, so the press can be attributed to this one.");
      return;
    }
    setError("");
    setLastPractice("Waiting for a press pattern…");
    setPracticeRef(device.ref);
    try {
      await KikiTrigger.setPractice({ on: true });
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      practiceTimeout.current = window.setTimeout(() => {
        practiceTimeout.current = null;
        if (mounted.current) {
          setPracticeRef(null);
          setLastPractice("Practice window ended. The trigger has been disarmed; review its status before arming again.");
        }
        void KikiTrigger.setPractice({ on: false }).catch(() => {
          if (mounted.current) setError("Could not stop practice mode.");
        });
      }, 60_000);
    } catch (cause) {
      setPracticeRef(null);
      setError(cause instanceof Error ? cause.message : "Could not start practice mode.");
    }
  }

  async function stopPractice() {
    if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
    practiceTimeout.current = null;
    setPracticeRef(null);
    await KikiTrigger.setPractice({ on: false });
  }

  if (!native) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Everyday devices</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Pair and verify everyday Bluetooth devices from the Kiki Android app.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Everyday devices</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Bluetooth pairing and media-control compatibility are different: add a device, connect it, then verify its press in Practice mode.</p>
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => void pairDevice()}><Link2 size={16} />Pair a device</button>
      </div>

      {paired.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Paired on this phone</h3>
          {paired.map((device) => (
            <button
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${selected?.address === device.address ? "border-[var(--accent)] bg-[var(--surface-2)]" : "border-[var(--line)]"}`}
              key={device.address}
              type="button"
              onClick={() => choose(device)}
            >
              <span className="min-w-0"><b className="block truncate">{device.btName}</b><small className="text-[var(--muted)]">{KIND_NAMES[device.kind]} · {device.connected ? "Connected" : "Paired"}</small></span>
              <span className="shrink-0 text-xs">{selected?.address === device.address ? "Selected" : "Choose"}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <form className="space-y-3 rounded-xl border border-[var(--line)] p-3" onSubmit={(event) => { event.preventDefault(); void addDevice(kind, selected); }}>
          <h3 className="font-semibold">Add {selected.btName} on this phone</h3>
          <label className="block text-sm">Your device label
            <input className="input mt-1 w-full" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="block text-sm">Type
            <select className="input mt-1 w-full" value={kind} onChange={(event) => setKind(event.target.value as EverydayDeviceKind)}>
              {Object.entries(KIND_NAMES).filter(([value]) => value !== "wired").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>Add to Kiki</button>
          <button className="btn ml-2" type="button" onClick={() => setSelected(null)}>Cancel</button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
        <div className="flex items-center gap-2 text-sm"><Headphones size={18} /><span><b>Wired headset</b><small className="block text-[var(--muted)]">Track its connection state on this phone</small></span></div>
        <button className="btn" type="button" disabled={busy || devices.some((device) => device.kind === "wired")} onClick={() => void addDevice("wired")}>Add wired device</button>
      </div>

      {devices.length > 0 ? (
        <ul className="space-y-2">
          {devices.map((device) => (
            <li key={device.ref} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{device.name}</p>
                <p className="text-xs text-[var(--muted)]">{KIND_NAMES[device.kind]} · {statusText(device.status)}</p>
                <p className="mt-1 text-xs">{device.verifiedAt ? <span className="inline-flex items-center gap-1 text-[var(--ok)]"><CheckCircle2 size={13} />Practice press verified</span> : "Not yet verified — press support is unknown"}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn" type="button" disabled={busy || practiceRef !== null} onClick={() => void startPractice(device)}>{practiceRef === device.ref ? "Listening…" : "Practice check"}</button>
                <button className="btn" type="button" aria-label={`Remove ${device.name}`} disabled={busy} onClick={() => void removeDevice(device)}><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--muted)]">No everyday devices added yet. Use Pair a device to open Android Bluetooth settings.</p>
      )}

      {practiceRef && (
        <div className="rounded-xl border border-[var(--accent)] p-3 text-sm" role="status" aria-live="polite">
          <p className="font-semibold">Practice mode is active for up to 60 seconds. No alert will be sent.</p>
          <p className="mt-1">{lastPractice}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Try a supported media-button pattern while this device is connected.</p>
          <button className="btn mt-2" type="button" onClick={() => void stopPractice()}>Stop practice</button>
        </div>
      )}
      {!practiceRef && lastPractice && <p className="text-sm" role="status">{lastPractice}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notifyDrop} onChange={(event) => { setNotifyDrop(event.target.checked); void KikiTrigger.setNotifyDrop({ on: event.target.checked }); }} />
        Notify me when a paired device disconnects
      </label>
      <p className="text-xs leading-relaxed text-[var(--muted)]">Bluetooth names and addresses stay encrypted on this phone and are never sent to Kiki’s server. Only your label, device type, verification time, and connection health are synchronised.</p>
      {busy && <span className="sr-only" role="status">Updating paired devices…</span>}
      {error && <p role="alert" className="text-sm text-[var(--crit)]">{error}</p>}
      <button type="button" className="btn" onClick={() => void refresh()}><RefreshCw size={15} />Refresh devices</button>
    </section>
  );
}
