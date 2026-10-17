"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { Bluetooth, CheckCircle2, ChevronRight, Headphones, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
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

function statusChipText(status: EverydayDevice["status"]) {
  switch (status) {
    case "connected": return "Connected";
    case "disconnected": return "Paired";
    case "unpaired": return "Reconnect";
    case "bluetooth_off": return "Bluetooth off";
    case "permission_needed": return "Permission needed";
    case "untracked": return "Unknown";
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
    setError("");
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

  async function closeFlow() {
    if (practiceRef) {
      try {
        await stopPractice();
      } catch {
        setError("Could not stop practice mode. Please stop it before closing this setup.");
        return;
      }
    }
    setFlowStep(0);
    setSelected(null);
  }

  async function toggleNotifyDrop() {
    const next = !notifyDrop;
    setNotifyDrop(next);
    try {
      await KikiTrigger.setNotifyDrop({ on: next });
    } catch {
      setNotifyDrop(!next);
      setError("Could not update disconnect notifications. Please try again.");
    }
  }

  if (!native) {
    return (
      <section className="everyday-devices-card">
        <div className="everyday-empty-card">
          <span className="everyday-empty-icon"><Bluetooth size={27} /></span>
          <h2>Manage phone accessories in Kiki for Android</h2>
          <p>Pair and verify everyday Bluetooth devices from the Kiki Android app.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="everyday-devices-card">
      {pairingMessage && <p className="everyday-message" role="status">{pairingMessage}</p>}

      <div className="everyday-section-heading">
        <div className="everyday-heading-copy">
          <span className="everyday-heading-icon"><Bluetooth size={23} /></span>
          <div>
            <p className="everyday-eyebrow">PHONE ACCESSORIES</p>
            <h2>Everyday devices</h2>
            <p>Track connections and check that an accessory can trigger Kiki.</p>
          </div>
        </div>
        <button className="everyday-primary-button" type="button" disabled={busy || devices.length >= 10} onClick={() => {
          setFlowStep(1);
          setSelected(null);
          setName("");
          setPairingMessage("");
          setError("");
        }}><Plus size={19} />Add a device</button>
      </div>

      {error && flowStep === 0 && <p role="alert" className="everyday-error">{error}</p>}

      {devices.length > 0 ? (
        <section className="everyday-device-section" aria-labelledby="everyday-list-title">
          <div className="everyday-section-title">
            <h3 id="everyday-list-title">Your devices</h3>
            <span>{devices.length}</span>
          </div>
          <ul className="everyday-device-list">
            {devices.map((device) => (
              <li className="everyday-device-entry" key={device.ref}>
                <span className={`everyday-device-icon${device.kind === "wired" ? " wired" : ""}`}>
                  {device.kind === "wired" ? <Headphones size={21} /> : <Bluetooth size={21} />}
                </span>
                <div className="everyday-device-copy">
                  <b>{device.name}</b>
                  <span>{KIND_NAMES[device.kind]} · {statusText(device.status)}</span>
                  <small>
                    {device.battery == null ? "Battery not reported" : `Battery ${device.battery}%`}
                    {" · "}
                    {device.lastConnectedAt ? `Last connected ${new Date(device.lastConnectedAt).toLocaleString()}` : "Not connected yet"}
                  </small>
                  <small className={device.verifiedAt ? "verified" : "unverified"}>
                    {device.verifiedAt ? <><CheckCircle2 size={13} />Practice press verified</> : "Not tested yet"}
                  </small>
                </div>
                <span className={`everyday-status-chip${device.status === "connected" ? " connected" : ""}`}>
                  {device.verifiedAt ? "Practiced" : statusChipText(device.status)}
                </span>
                <div className="everyday-device-actions">
                  <Link
                    className="everyday-action-button"
                    href={`/account/profile/triggers/lab?deviceRef=${encodeURIComponent(device.profileRef || device.ref)}`}
                    onClick={() => setFlowStep(0)}
                  >
                    Gesture setup
                  </Link>
                  <button className="everyday-action-button primary" type="button" disabled={busy || practiceRef !== null} onClick={() => void startPractice(device)}>
                    {practiceRef === device.ref ? "Listening…" : "Practice"}
                  </button>
                  <button className="everyday-action-button" type="button" onClick={() => setInfoDevice(device)}>How to use</button>
                  {device.status !== "connected" && <button className="everyday-action-button" type="button" onClick={() => setReconnectDevice(device)}>Reconnect</button>}
                  <details className="everyday-more">
                    <summary aria-label={`More actions for ${device.name}`}>More<ChevronRight size={15} /></summary>
                    <div>
                      <button type="button" onClick={() => {
                        const next = window.prompt("Choose a name for this device.", device.name)?.trim();
                        if (next) void KikiTrigger.renameDevice({ ref: device.ref, name: next }).then(refresh).catch(() => setError("Could not rename this device."));
                      }}>Rename</button>
                      <button type="button" onClick={() => setReconnectDevice(device)}>Reconnect</button>
                      <button type="button" onClick={() => void removeDevice(device)}>Remove</button>
                    </div>
                  </details>
                  <button className="everyday-action-button remove" type="button" aria-label={`Remove ${device.name}`} disabled={busy} onClick={() => void removeDevice(device)}><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="everyday-empty-card">
          <span className="everyday-empty-icon"><Headphones size={29} /></span>
          <div>
            <h3>No everyday devices yet</h3>
            <p>Add earbuds or a headset to track its connection and practice triggering Kiki.</p>
          </div>
          <button className="everyday-primary-button" type="button" disabled={busy} onClick={() => {
            setFlowStep(1);
            setSelected(null);
            setName("");
          }}><Plus size={19} />Add a device</button>
        </div>
      )}

      <section className="everyday-device-section" aria-labelledby="wired-title">
        <h3 className="everyday-section-label" id="wired-title">Wired</h3>
        <div className="everyday-simple-list">
          <div className="everyday-simple-row">
            <span className="everyday-small-icon"><Headphones size={20} /></span>
            <span className="everyday-simple-copy"><b>Wired headset</b><small>Track its connection on this phone</small></span>
            {devices.some((device) => device.kind === "wired")
              ? <span className="everyday-status-chip connected">Added</span>
              : <button className="everyday-row-add" type="button" disabled={busy || devices.length >= 10} onClick={() => { setKind("wired"); setName("Wired headphones"); setFlowStep(3); }}><Plus size={16} />Add</button>}
          </div>
        </div>
      </section>

      <section className="everyday-device-section" aria-labelledby="alerts-title">
        <h3 className="everyday-section-label" id="alerts-title">Alerts</h3>
        <div className="everyday-simple-list">
          <div className="everyday-simple-row">
            <span className="everyday-simple-copy"><b>Notify me on disconnect</b><small>When a paired device drops</small></span>
            <button className={`everyday-toggle${notifyDrop ? " on" : ""}`} type="button" role="switch" aria-checked={notifyDrop} aria-label="Notify me when a paired device disconnects" onClick={() => void toggleNotifyDrop()}><i /></button>
          </div>
        </div>
      </section>

      <p className="everyday-privacy"><ShieldCheck size={17} /><span>Bluetooth names and addresses stay encrypted on this phone and never reach Kiki’s server. Only your label, device type, verification time, and connection health sync.</span></p>

      {practiceRef && flowStep !== 4 && (
        <div className="everyday-practice-status" role="status" aria-live="polite">
          <b>Practice mode is active for up to 2 minutes. No alert will be sent.</b>
          <span>{lastPractice}</span>
          <small>Try a supported media-button pattern while this device is connected.</small>
          <button className="everyday-action-button" type="button" onClick={() => void stopPractice()}>Stop practice</button>
        </div>
      )}
      {!practiceRef && lastPractice && <p className="everyday-message" role="status">{lastPractice}</p>}
      {busy && <span className="sr-only" role="status">Updating paired devices…</span>}
      <button type="button" className="everyday-refresh" onClick={() => void refresh()}><RefreshCw size={16} />Refresh devices</button>
      <p className="everyday-footnote">Pairing alone doesn’t confirm a device sends supported controls. Practice it to be sure.</p>

      {flowStep > 0 && typeof document !== "undefined" && createPortal(
        <div className="everyday-sheet-backdrop" onClick={(event) => { if (event.target === event.currentTarget) void closeFlow(); }}>
          <section className="everyday-sheet" role="dialog" aria-modal="true" aria-labelledby="everyday-sheet-title">
            <div className="everyday-sheet-top">
              <div className="everyday-progress" aria-label={`Step ${Math.min(flowStep, 5)} of 5`}>
                {[1, 2, 3, 4, 5].map((step) => <i key={step} className={flowStep >= step ? "done" : ""} />)}
              </div>
              <button className="everyday-sheet-close" type="button" aria-label="Close setup" onClick={() => void closeFlow()}><X size={19} /></button>
            </div>
            <p className="everyday-step-label">STEP {Math.min(flowStep, 5)} OF 5 · {["", "CHOOSE TYPE", "CONNECT", "NAME", "PRACTICE", "DONE"][flowStep]}</p>
            <div className="everyday-sheet-body">
              {error && <p role="alert" className="everyday-error">{error}</p>}
              {flowStep === 1 && <>
                <h2 id="everyday-sheet-title">What kind of device?</h2>
                <p>Pick the closest match. You can rename it later.</p>
                <div className="everyday-type-grid">
                  {EVERYDAY_DEVICE_KINDS.map((value) => (
                    <button key={value} type="button" className={`everyday-type-tile${kind === value ? " selected" : ""}`} onClick={() => setKind(value)}>
                      <span>{value === "wired" ? <Headphones size={20} /> : <Bluetooth size={20} />}</span>
                      <b>{KIND_NAMES[value]}</b>
                    </button>
                  ))}
                </div>
                <button className="everyday-primary-button full" type="button" onClick={() => {
                  if (EVERYDAY_DEVICE_GUIDES[kind].pairing === "plug") {
                    setName("Wired headphones");
                    setFlowStep(3);
                  } else if (EVERYDAY_DEVICE_GUIDES[kind].pairing === "manual") {
                    setFlowStep(2);
                  } else {
                    void pairDevice();
                  }
                }}>Continue</button>
                <button className="everyday-sheet-text-button" type="button" onClick={() => void closeFlow()}>Cancel</button>
              </>}
              {flowStep === 2 && <>
                <h2 id="everyday-sheet-title">Connect it</h2>
                <p>{EVERYDAY_DEVICE_GUIDES[kind].connect} Select it below once it’s paired.</p>
                <button className="everyday-secondary-button full" type="button" disabled={busy} onClick={() => void pairDevice()}><Bluetooth size={18} />Open Bluetooth settings</button>
                {paired.length > 0 && <>
                  <h3 className="everyday-paired-title">Paired on this phone</h3>
                  <div className="everyday-paired-list">
                    {paired.map((device) => (
                      <button className={`everyday-paired-row${selected?.address === device.address ? " selected" : ""}`} key={device.address} type="button" onClick={() => choose(device)}>
                        <span><b>{device.btName}</b><small>{KIND_NAMES[device.kind]} · {device.connected ? "Connected" : "Paired"}</small></span>
                        <i aria-label={selected?.address === device.address ? "Selected" : "Choose"} />
                      </button>
                    ))}
                  </div>
                </>}
                <button className="everyday-sheet-text-button" type="button" onClick={() => {
                  setSelected(null);
                  setName(kind === "watch" ? "My watch" : `${KIND_NAMES[kind]} device`);
                  setPairingMessage(`Add ${kind === "watch" ? "a watch" : `a ${KIND_NAMES[kind].toLowerCase()}`} manually. It must deliver standard media-button events to this phone; pairing alone is not enough.`);
                  setFlowStep(3);
                }}>{kind === "watch" ? "My watch isn’t listed? Add manually" : "Device isn’t listed? Add manually"}</button>
                {selected && <button className="everyday-primary-button full" type="button" onClick={() => setFlowStep(3)}>Continue with {selected.btName}</button>}
                <button className="everyday-sheet-text-button" type="button" onClick={() => setFlowStep(1)}>Back</button>
              </>}
              {flowStep === 3 && <>
                <h2 id="everyday-sheet-title">Name it</h2>
                <p>A label you’ll recognise. This is the only device name Kiki’s server sees.</p>
                <label className="everyday-name-label">Device name
                  <input className="everyday-name-input" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                {selected && <p className="everyday-selected-note">Selected from this phone’s paired devices: {selected.btName}</p>}
                <button className="everyday-primary-button full" type="button" disabled={busy || !name.trim()} onClick={() => void addDevice(kind, selected ?? undefined)}>Add device and continue</button>
                <button className="everyday-sheet-text-button" type="button" onClick={() => setFlowStep(kind === "wired" ? 1 : 2)}>Back</button>
              </>}
              {flowStep === 4 && (() => {
                const added = devices.find((device) => device.ref === lastAddedRef);
                return <>
                  <h2 id="everyday-sheet-title">Practice a press</h2>
                  <p>{EVERYDAY_DEVICE_GUIDES[added?.kind ?? kind].practice}</p>
                  <div className={`everyday-practice-orb${practiceRef === lastAddedRef ? " listening" : ""}`} aria-hidden="true"><Bluetooth size={42} /></div>
                  {practiceRef === lastAddedRef
                    ? <p className="everyday-listening" role="status" aria-live="polite">{lastPractice} · listening for the device button…</p>
                    : <button className="everyday-primary-button full" type="button" disabled={busy || !added} onClick={() => added && void startPractice(added)}>Start practice check</button>}
                  <p className="everyday-selected-note">Practice never sends an alert. The device stays “Not tested yet” until a supported rhythm is detected.</p>
                  <button className="everyday-sheet-text-button" type="button" onClick={() => void closeFlow()}>Finish later</button>
                </>;
              })()}
              {flowStep === 5 && <>
                <div className="everyday-practice-orb complete"><CheckCircle2 size={45} /></div>
                <h2 className="everyday-centered-title" id="everyday-sheet-title">{KIND_NAMES[devices.find((device) => device.ref === lastAddedRef)?.kind ?? kind]} is ready</h2>
                <p className="everyday-centered-copy">Kiki heard your press. Connection health is now tracked on this phone.</p>
                <button className="everyday-primary-button full" type="button" onClick={() => { setFlowStep(0); setName(""); setPairingMessage(""); setLastAddedRef(null); }}>Done</button>
              </>}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {infoDevice && typeof document !== "undefined" && createPortal(
        <div className="everyday-sheet-backdrop" onClick={() => setInfoDevice(null)}>
          <section className="everyday-sheet info" role="dialog" aria-modal="true" aria-label="How to use this device" onClick={(event) => event.stopPropagation()}>
            <button className="everyday-sheet-close" type="button" aria-label="Close" onClick={() => setInfoDevice(null)}><X size={19} /></button>
            <div className="everyday-sheet-body">
              <h2>{infoDevice.name}</h2>
              <p>{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].press}</p>
              <p>{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].practice}</p>
              <h3 className="everyday-paired-title">Reconnect steps</h3>
              <ol className="everyday-reconnect-list">{EVERYDAY_DEVICE_GUIDES[infoDevice.kind].reconnect.map((step) => <li key={step}>{step}</li>)}</ol>
              <button className="everyday-secondary-button full" type="button" onClick={() => setInfoDevice(null)}>Close</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
      {reconnectDevice && typeof document !== "undefined" && createPortal(
        <div className="everyday-sheet-backdrop" onClick={() => setReconnectDevice(null)}>
          <section className="everyday-sheet info" role="dialog" aria-modal="true" aria-label="Reconnect device" onClick={(event) => event.stopPropagation()}>
            <button className="everyday-sheet-close" type="button" aria-label="Close" onClick={() => setReconnectDevice(null)}><X size={19} /></button>
            <div className="everyday-sheet-body">
              <h2>Reconnect {reconnectDevice.name}</h2>
              <p>Android controls the Bluetooth connection; Kiki cannot reconnect an accessory itself.</p>
              <ol className="everyday-reconnect-list">{EVERYDAY_DEVICE_GUIDES[reconnectDevice.kind].reconnect.map((step) => <li key={step}>{step}</li>)}</ol>
              <button className="everyday-primary-button full" type="button" onClick={() => void KikiTrigger.openBluetoothSettings().catch(() => setError("Could not open Bluetooth settings."))}>Open Bluetooth settings</button>
              <button className="everyday-sheet-text-button" type="button" onClick={() => { setReconnectDevice(null); void refresh(); }}>Done</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
