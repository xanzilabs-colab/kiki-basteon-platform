"use client";

import Image from "next/image";
import Link from "next/link";
import { BatteryCharging, ChevronLeft, ChevronRight, Clock3, Lock, Pencil, Plus, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pinErrorMessage } from "@/lib/devicePin";
import type { Device } from "@/lib/types";
import "./devicesPage.css";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function relativeTime(value: string | null | undefined) {
  if (!value) return "Never seen";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Last seen time unavailable";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function signalLabel(rssi: number | null | undefined) {
  if (rssi == null) return "Not reported";
  if (rssi >= -55) return `Strong · ${rssi} dBm`;
  if (rssi >= -70) return `Good · ${rssi} dBm`;
  return `Weak · ${rssi} dBm`;
}

function isDeviceOnline(device: Device) {
  const lastSignal = device.telemetry_at ?? device.last_seen_at;
  return Boolean(device.active && lastSignal && Date.now() - new Date(lastSignal).getTime() <= ONLINE_WINDOW_MS);
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const { data, error: queryError } = await createClient()
        .from("devices")
        .select("*")
        .order("linked_at", { ascending: false });
      if (queryError) throw queryError;
      const linkedDevices = (data ?? []) as Device[];
      setDevices(linkedDevices);
      setSelectedIndex((index) => Math.min(index, Math.max(linkedDevices.length - 1, 0)));
    } catch {
      setError("Could not load your linked devices. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedDevice = devices[selectedIndex];
  const latestSignal = selectedDevice?.telemetry_at ?? selectedDevice?.last_seen_at ?? null;
  const selectedOnline = selectedDevice ? isDeviceOnline(selectedDevice) : false;

  function selectDevice(index: number) {
    if (!devices.length) return;
    setSelectedIndex((index + devices.length) % devices.length);
  }

  async function rename(device: Device) {
    const deviceName = window.prompt("Device nickname", device.device_name);
    if (!deviceName?.trim()) return;
    try {
      const response = await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: deviceName.trim() }),
      });
      if (!response.ok) throw new Error("Could not rename device.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename device.");
    }
  }

  async function unlink(device: Device) {
    if (device.pin_locked) return router.push(`/account/devices/${device.id}/security#unlink`);
    if (!window.confirm(`Unlink ${device.device_name}?`)) return;
    try {
      const response = await fetch(`/api/devices/${device.id}/unlink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(pinErrorMessage(await response.json().catch(() => ({}))) ?? "Could not unlink device.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink device.");
    }
  }

  return <div className="kiki-devices-redesign">
    <header className="devices-heading">
      <div>
        <h1>My devices</h1>
        {!loading && devices.length > 0 && <p>{devices.length} {devices.length === 1 ? "device" : "devices"} linked</p>}
      </div>
      <Link className="devices-link-button" href="/account/devices/link"><Plus size={16} />Link device</Link>
    </header>

    {error && <p className="devices-error" role="alert">{error}</p>}

    {loading ? (
      <div className="devices-loading" role="status">Loading your devices…</div>
    ) : selectedDevice ? (
      <>
        <section className={`devices-hero${selectedOnline ? " is-online" : ""}`} aria-label="Selected device">
          <div className="devices-stage">
            <div className="device-orbit device-orbit-one" />
            <div className="device-orbit device-orbit-two" />
            <div className="device-floor" />
            <div className="device-pendant" aria-label="3D illustration of a Kiki device">
              <span className="device-grip device-grip-left" />
              <span className="device-grip device-grip-right" />
              <span className="device-lens" />
              <Image className="device-logo" src="/assets/kiki-icon.png" alt="Kiki" width={88} height={50} priority />
            </div>
            {devices.length > 1 && <>
              <button className="devices-carousel-arrow previous" type="button" onClick={() => selectDevice(selectedIndex - 1)} aria-label="Previous device"><ChevronLeft size={20} /></button>
              <button className="devices-carousel-arrow next" type="button" onClick={() => selectDevice(selectedIndex + 1)} aria-label="Next device"><ChevronRight size={20} /></button>
            </>}
          </div>
          <div className="devices-hero-copy">
            <h2>{selectedDevice.device_name}</h2>
            <p className="devices-id">{selectedDevice.device_id}</p>
            <span className={`devices-status${selectedOnline ? " connected" : ""}`}><i />{selectedOnline ? "Connected" : selectedDevice.active ? "Offline" : "Inactive"}</span>
            {devices.length > 1 && <div className="devices-pagination" aria-label={`Device ${selectedIndex + 1} of ${devices.length}`}>
              {devices.map((device, index) => <button key={device.id} type="button" className={index === selectedIndex ? "selected" : ""} aria-label={`Show ${device.device_name}`} aria-current={index === selectedIndex ? "true" : undefined} onClick={() => selectDevice(index)} />)}
            </div>}
          </div>
        </section>

        <section className="devices-metrics" aria-label="Device status">
          <article className={`devices-metric${selectedDevice.battery != null && selectedDevice.battery < 20 ? " is-warning" : ""}`}>
            <BatteryCharging size={21} />
            <small>Battery</small>
            <b>{selectedDevice.battery == null ? "Not reported" : `${selectedDevice.battery}%`}</b>
          </article>
          <article className={`devices-metric${!selectedOnline ? " is-muted" : ""}`}>
            <Wifi size={21} />
            <small>Signal</small>
            <b>{selectedOnline ? signalLabel(selectedDevice.wifi_rssi) : "Offline"}</b>
          </article>
          <article className="devices-metric">
            <Clock3 size={21} />
            <small>Last seen</small>
            <b>{relativeTime(latestSignal)}</b>
          </article>
        </section>

        <section className="devices-actions" aria-label="Device actions">
          <button type="button" onClick={() => void rename(selectedDevice)}>
            <span className="devices-action-icon"><Pencil size={18} /></span>
            <span><b>Rename</b><small>{selectedDevice.device_name}</small></span>
            <ChevronRight size={18} />
          </button>
          <Link href={`/account/devices/${selectedDevice.id}/security`}>
            <span className="devices-action-icon"><Lock size={19} /></span>
            <span><b>Device PIN</b><small>{selectedDevice.pin_locked ? "Required to change or unlink" : "Anyone can change or unlink"}</small></span>
            <span className={`devices-pin-switch${selectedDevice.pin_locked ? " is-on" : ""}`} aria-label={selectedDevice.pin_locked ? "PIN is on" : "PIN is off"}><i /></span>
          </Link>
          <button className="remove-device-action" type="button" onClick={() => void unlink(selectedDevice)}>
            <span className="devices-action-icon"><Trash2 size={18} /></span>
            <span><b>Remove device</b><small>Unlink it from your account</small></span>
            <ChevronRight size={18} />
          </button>
        </section>

        <section className="devices-all">
          <div className="devices-list-title"><h2>All devices</h2><span>{devices.length}</span></div>
          <div className="devices-list">
            {devices.map((device, index) => {
              const online = isDeviceOnline(device);
              const lowBattery = device.battery != null && device.battery < 20;
              return <button type="button" key={device.id} className={`devices-list-row${index === selectedIndex ? " selected" : ""}`} onClick={() => selectDevice(index)} aria-current={index === selectedIndex ? "true" : undefined}>
                <span className="devices-list-art"><Image src="/assets/devices-icon-link.png" alt="" width={45} height={45} /></span>
                <span className="devices-list-copy"><b>{device.device_name}</b><small>{online && device.battery != null ? `Battery ${device.battery}%` : `Last seen ${relativeTime(device.telemetry_at ?? device.last_seen_at)}`}</small></span>
                <span className={`devices-list-badge${online ? lowBattery ? " low" : " online" : ""}`}><i />{online ? lowBattery ? "Low battery" : "Connected" : "Offline"}</span>
              </button>;
            })}
          </div>
        </section>

        <Link className="devices-add-another" href="/account/devices/link"><Plus size={17} />Link another device</Link>
      </>
    ) : error ? (
      <section className="devices-empty">
        <div className="devices-empty-art"><Image src="/assets/devices-icon-link.png" alt="" width={105} height={105} /></div>
        <h2>Couldn’t load your devices</h2>
        <p>Check your connection and try again.</p>
        <button type="button" onClick={() => void refresh()}>Try again</button>
      </section>
    ) : (
      <section className="devices-empty">
        <div className="devices-empty-art"><Image src="/assets/devices-icon-link.png" alt="" width={105} height={105} /></div>
        <h2>No devices linked yet</h2>
        <p>Link a Kiki Smart Clip or tracker to start hardware protection.</p>
        <Link href="/account/devices/link"><Plus size={17} />Link a Kiki device</Link>
        <span><ShieldCheck size={15} />Your Kiki device helps keep your account protected.</span>
      </section>
    )}

  </div>;
}
