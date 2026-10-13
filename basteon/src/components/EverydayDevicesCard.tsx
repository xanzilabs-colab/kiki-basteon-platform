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
import { EVERYDAY_DEVICE_GUIDES, EVERYDAY_DEVICE_KINDS } from "@/lib/everydayDevices";

const KIND_NAMES = Object.fromEntries(EVERYDAY_DEVICE_KINDS.map((kind) => [kind, EVERYDAY_DEVICE_GUIDES[kind].label])) as Record<EverydayDeviceKind, string>;

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
  const [flowStep, setFlowStep] = useState(0);
  const [lastAddedRef, setLastAddedRef] = useState<string | null>(null);
  const [lastPractice, setLastPractice] = useState("");
  const [pairingMessage, setPairingMessage] = useState("");
  const [infoDevice, setInfoDevice] = useState<EverydayDevice | null>(null);
  const [reconnectDevice, setReconnectDevice] = useState<EverydayDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const practiceTimeout = useRef<number | null>(null);
  const mounted = useRef(true);
  const pairingSnapshot = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    if (!native || !mounted.current) return;
    try {
      const [saved, bonded, status] = await Promise.all([KikiTrigger.devices(), KikiTrigger.pairedDevices(), KikiTrigger.status()]);
      if (!mounted.current) return;
      setDevices(saved.devices);
      const newlyPaired = pairingSnapshot.current
        ? bonded.devices.find((device) => !pairingSnapshot.current?.has(device.address))
        : undefined;
      if (newlyPaired) {
        setSelected(newlyPaired);
        setKind(newlyPaired.kind);
        setName(`${KIND_NAMES[newlyPaired.kind]} device`);
        setPairingMessage(`New device found: ${newlyPaired.btName}. Add it?`);
        setFlowStep(3);
        pairingSnapshot.current = null;
      }
      setPaired(newlyPaired
        ? [newlyPaired, ...bonded.devices.filter((device) => device.address !== newlyPaired.address)]
        : bonded.devices);
      setNotifyDrop(status.notifyDrop);
    } catch {
      if (mounted.current) setError("Could not read paired devices. Check Bluetooth permission and try again.");
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const subscription = KikiTrigger.addListener("devices", ({ devices: current }) => {
      if (mounted.current) setDevices(current);
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      void subscription.then((handle) => handle.remove());
      mounted.current = false;
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      if (activePractice.current) {
        activePractice.current = false;
        void KikiTrigger.setPractice({ on: false }).catch((cause) => {
          console.error("Could not stop native Bluetooth practice mode while closing the device screen.", cause);
        });
      }
    };
  }, [refresh]);

  useEffect(() => {
    const subscription = KikiTrigger.addListener("event", (event: TriggerEvent) => {
      if (event.type !== "sequence") return;
      const detected = event.pattern ?? (event.sequence ? `Practice sequence ${event.sequence}` : "Practice input detected");
      setLastPractice(detected);
      if (!practiceRef || !event.pattern) return;
      const current = devices.find((device) => device.ref === practiceRef);
      if (current?.status !== "connected" && current?.status !== "untracked") return;
      void KikiTrigger.markVerified({ ref: practiceRef })
        .then(() => {
          setLastPractice(`${KIND_NAMES[current.kind]} practice press detected`);
          setPracticeRef(null);
          activePractice.current = false;
          if (lastAddedRef === practiceRef) setFlowStep(5);
          if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
          return KikiTrigger.setPractice({ on: false });
        })
        .then(refresh)
        .catch(() => setError("The practice press was detected, but device verification could not be saved."));
    });
    return () => { void subscription.then((handle) => handle.remove()); };
  }, [devices, lastAddedRef, practiceRef, refresh]);

  async function pairDevice() {
    setError("");
    setBusy(true);
    try {
      const permission = await KikiTrigger.requestBluetooth();
      if (!permission.granted) throw new Error("Allow Nearby devices permission before choosing a paired device.");
      const current = await KikiTrigger.pairedDevices();
      pairingSnapshot.current = new Set(current.devices.map((device) => device.address));
      setFlowStep(2);
      setPairingMessage("Pair the accessory in Android settings, then return here.");
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
    setFlowStep(3);
  }

  async function addDevice(deviceKind: EverydayDeviceKind, bluetoothDevice?: PairedBluetoothDevice) {
    const label = name.trim() || (deviceKind === "wired" ? "Wired headphones" : `${KIND_NAMES[deviceKind]} device`);
    setBusy(true);
    setError("");
    const ref = crypto.randomUUID();
    try {
      await KikiTrigger.registerDevice({
        ref,
        kind: deviceKind,
        name: label,
        address: bluetoothDevice?.address,
        btName: bluetoothDevice?.btName,
      });
      setSelected(null);
      setLastAddedRef(ref);
      setFlowStep(4);
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
    if (device.status !== "connected" && device.status !== "untracked") {
      setError("Connect or enable this device first, then run its practice check.");
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
      activePractice.current = true;
      if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
      practiceTimeout.current = window.setTimeout(() => {
        practiceTimeout.current = null;
        if (mounted.current) {
          setPracticeRef(null);
          setLastPractice("Practice window ended. The trigger has been disarmed; review its status before arming again.");
        }
        activePractice.current = false;
        void KikiTrigger.setPractice({ on: false }).catch(() => {
          if (mounted.current) setError("Could not stop practice mode.");
        });
      }, 120_000);
    } catch (cause) {
      setPracticeRef(null);
      setError(cause instanceof Error ? cause.message : "Could not start practice mode.");
    }
  }

  async function stopPractice() {
    if (practiceTimeout.current !== null) window.clearTimeout(practiceTimeout.current);
    practiceTimeout.current = null;
    setPracticeRef(null);
    activePractice.current = false;
    await KikiTrigger.setPractice({ on: false });
  }

  const activePractice = useRef(false);

  if (!native) {
    return (
      <section className="everyday-devices-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="font-semibold">Everyday devices</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Pair and verify everyday Bluetooth devices from the Kiki Android app.</p>
      </section>
    );
  }

  return (
    <section className="everyday-devices-card space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bluetooth size={18} />Everyday devices</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Pair, connect and test each accessory. Only verified standard media-button inputs can trigger Kiki; pairing alone is not evidence of compatibility.</p>
        </div>
        {pairingMessage && <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm" role="status">{pairingMessage}</p>}
        <button className="btn btn-primary" type="button" disabled={busy || devices.length >= 10} onClick={() => {
          setFlowStep(1);
          setSelected(null);
          setName("");
          setPairingMessage("");
        }}><Link2 size={16} />Add an everyday device</button>
      </div>
      {flowStep > 0 && (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Add device steps">
            {["Choose type", "Connect", "Name", "Learn & practice", "Done"].map((label, index) => (
              <span key={label} aria-current={flowStep === index + 1 ? "step" : undefined} className={`rounded-full px-2.5 py-1 ${flowStep === index + 1 ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--muted)]"}`}>{index + 1}. {label}</span>
            ))}
          </div>
          {flowStep === 1 && <>
            <label className="block text-sm font-medium">What kind of device?
              <select className="input mt-1 w-full" value={kind} onChange={(event) => setKind(event.target.value as EverydayDeviceKind)}>
                {EVERYDAY_DEVICE_KINDS.map((value) => <option key={value} value={value}>{KIND_NAMES[value]}</option>)}
              </select>
            </label>
            <p className="text-sm text-[var(--muted)]">{EVERYDAY_DEVICE_GUIDES[kind].connect}</p>
            <button className="btn btn-primary" type="button" onClick={() => {
              if (EVERYDAY_DEVICE_GUIDES[kind].pairing === "plug") {
                setName("Wired headphones");
                setFlowStep(3);
              } else if (EVERYDAY_DEVICE_GUIDES[kind].pairing === "manual") {
                setFlowStep(2);
              } else {
                void pairDevice();
              }
            }}>Continue</button>
            <button className="btn" type="button" onClick={() => setFlowStep(0)}>Cancel</button>
          </>}
          {flowStep === 2 && <>
            <p className="text-sm">{EVERYDAY_DEVICE_GUIDES[kind].connect}</p>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void pairDevice()}>Open Android Bluetooth settings</button>
            <button className="btn" type="button" onClick={() => {
              setSelected(null);
              setName(kind === "watch" ? "My watch" : `${KIND_NAMES[kind]} device`);
              setPairingMessage(`Add ${kind === "watch" ? "a watch" : `a ${KIND_NAMES[kind].toLowerCase()}`} manually. It must deliver standard media-button events to this phone; pairing alone is not enough.`);
              setFlowStep(3);
            }}>{kind === "watch" ? "My watch isn’t listed" : "Device isn’t listed? Add manually"}</button>
            <button className="btn" type="button" onClick={() => setFlowStep(1)}>Back</button>
          </>}
          {flowStep === 3 && <>
            <label className="block text-sm font-medium">Device name
              <input className="input mt-1 w-full" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            {selected && <p className="text-xs text-[var(--muted)]">Selected from the phone’s paired devices: {selected.btName}</p>}
            <button className="btn btn-primary" type="button" disabled={busy || !name.trim()} onClick={() => void addDevice(kind, selected ?? undefined)}>Add device and continue</button>
            <button className="btn" type="button" onClick={() => setFlowStep(kind === "wired" ? 1 : 2)}>Back</button>
          </>}
          {flowStep === 4 && (() => {
            const added = devices.find((device) => device.ref === lastAddedRef);
            return <div className="space-y-2">
              <p className="font-medium">Learn the button rhythm</p>
              <p className="text-sm text-[var(--muted)]">{EVERYDAY_DEVICE_GUIDES[added?.kind ?? kind].practice}</p>
              {practiceRef === lastAddedRef ? <p className="text-sm" role="status" aria-live="polite">{lastPractice} · waiting for the device button…</p> : <button className="btn btn-primary" type="button" disabled={busy || !added} onClick={() => added && void startPractice(added)}>Start a local-only practice check</button>}
              <p className="text-xs text-[var(--muted)]">Practice never sends an alert. This device stays “Not tested yet” until a complete supported rhythm is detected.</p>
              <button className="btn" type="button" onClick={() => setFlowStep(0)}>Finish later</button>
            </div>;
          })()}
          {flowStep === 5 && <>
            <p className="font-semibold text-[var(--ok)]">{KIND_NAMES[devices.find((device) => device.ref === lastAddedRef)?.kind ?? kind]} practice press verified.</p>
            <p className="text-sm text-[var(--muted)]">This confirms a media-key event arrived during practice; it cannot guarantee future delivery or identify the accessory at the Android system level.</p>
            <button className="btn btn-primary" type="button" onClick={() => { setFlowStep(0); setName(""); setPairingMessage(""); setLastAddedRef(null); }}>Done</button>
          </>}
        </div>
      )}

      {flowStep === 2 && paired.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Paired on this phone</h3>
          {paired.map((device) => (
            <button
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-[var(--text)] ${selected?.address === device.address ? "border-[#39734f] bg-[#eaf3ec] ring-1 ring-[#39734f]" : "border-[var(--line)] bg-[var(--surface)]"}`}
              key={device.address}
              type="button"
              onClick={() => choose(device)}
            >
              <span className="min-w-0"><b className="block truncate text-[var(--text)]">{device.btName}</b><small className="text-[var(--text-2)]">{KIND_NAMES[device.kind]} · {device.connected ? "Connected" : "Paired"}</small></span>
              <span className="shrink-0 text-xs font-semibold text-[var(--text-2)]">{selected?.address === device.address ? "Selected" : "Choose"}</span>
            </button>
          ))}
        </div>
      )}
      {flowStep === 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
        <div className="flex items-center gap-2 text-sm"><Headphones size={18} /><span><b>Wired headset</b><small className="block text-[var(--muted)]">Track its connection state on this phone</small></span></div>
        <button className="btn" type="button" disabled={busy || devices.some((device) => device.kind === "wired") || devices.length >= 10} onClick={() => { setKind("wired"); setName("Wired headphones"); setFlowStep(3); }}>Add wired device</button>
      </div>}

      {devices.length > 0 ? (
        <ul className="space-y-2">
          {devices.map((device) => (
            <li key={device.ref} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{device.name}</p>
                <p className="text-xs text-[var(--muted)]">{KIND_NAMES[device.kind]} · {statusText(device.status)}</p>
                <p className="mt-1 text-xs">{device.battery == null ? <span className="text-[var(--warn)]">Battery not reported</span> : <span className={device.battery < 20 ? "text-[var(--warn)]" : ""}>Battery {device.battery}%</span>} · Last connected {device.lastConnectedAt ? new Date(device.lastConnectedAt).toLocaleString() : "Not recorded"}</p>
                <p className="mt-1 text-xs">{device.verifiedAt ? <span className="inline-flex items-center gap-1 text-[var(--ok)]"><CheckCircle2 size={13} />Practice press verified</span> : <span className="text-[var(--warn)]">Not tested yet</span>}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" type="button" disabled={busy || practiceRef !== null} onClick={() => void startPractice(device)}>{practiceRef === device.ref ? "Listening…" : "Practice check"}</button>
                <button className="btn" type="button" aria-label="How to use this device" onClick={() => setInfoDevice(device)}>How to use</button>
                {device.status !== "connected" && <button className="btn btn-primary" type="button" onClick={() => setReconnectDevice(device)}>Reconnect</button>}
                <details className="relative">
                  <summary className="btn cursor-pointer list-none">More</summary>
                  <div className="absolute right-0 z-10 mt-1 grid min-w-36 gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-xl">
                    <button className="btn justify-start" type="button" onClick={() => {
                      const next = window.prompt("Choose a name for this device.", device.name)?.trim();
                      if (next) void KikiTrigger.renameDevice({ ref: device.ref, name: next }).then(refresh).catch(() => setError("Could not rename this device."));
                    }}>Rename</button>
                    <button className="btn justify-start" type="button" onClick={() => setReconnectDevice(device)}>Reconnect</button>
                    <button className="btn justify-start" type="button" onClick={() => void removeDevice(device)}>Remove</button>
                  </div>
                </details>
                <button className="btn" type="button" aria-label={`Remove ${device.name}`} disabled={busy} onClick={() => void removeDevice(device)}><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--muted)]">No everyday devices added yet. Use Pair a device to open Android Bluetooth settings.</p>
      )}

      {practiceRef && flowStep !== 4 && (
        <div className="rounded-xl border border-[var(--accent)] p-3 text-sm" role="status" aria-live="polite">
          <p className="font-semibold">Practice mode is active for up to 2 minutes. No alert will be sent.</p>
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
      {infoDevice && (
        <div className="fixed inset-0 z-50 grid items-end bg-black/60 p-3 sm:items-center sm:justify-center" onClick={() => setInfoDevice(null)}>
          <section className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5" role="dialog" aria-modal="true" aria-label="How to use this device" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-semibold">{infoDevice.name}</h3>
            <p className="mt-3 text-sm">{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].press}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].practice}</p>
            <h4 className="mt-4 font-semibold">Reconnect steps</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].reconnect.map((step) => <li key={step}>{step}</li>)}</ol>
            <button className="btn mt-4" type="button" onClick={() => setInfoDevice(null)}>Close</button>
          </section>
        </div>
      )}
      {reconnectDevice && (
        <div className="fixed inset-0 z-50 grid items-end bg-black/60 p-3 sm:items-center sm:justify-center" onClick={() => setReconnectDevice(null)}>
          <section className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5" role="dialog" aria-modal="true" aria-label="Reconnect device" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-semibold">Reconnect {reconnectDevice.name}</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">Android controls the Bluetooth connection; Kiki cannot reconnect an accessory itself.</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">{EVERYDAY_DEVICE_GUIDES[reconnectDevice.kind].reconnect.map((step) => <li key={step}>{step}</li>)}</ol>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary" type="button" onClick={() => void KikiTrigger.openBluetoothSettings().catch(() => setError("Could not open Bluetooth settings."))}>Open Bluetooth settings</button>
              <button className="btn" type="button" onClick={() => { setReconnectDevice(null); void refresh(); }}>Done</button>
            </div>
          </section>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-[var(--crit)]">{error}</p>}
      <button type="button" className="btn" onClick={() => void refresh()}><RefreshCw size={15} />Refresh devices</button>
    </section>
  );
}
