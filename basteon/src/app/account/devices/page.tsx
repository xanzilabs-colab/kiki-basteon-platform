"use client";

import Image from "next/image";
import Link from "next/link";
import { BatteryCharging, Clock3, Lock, PlusCircle, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pinErrorMessage } from "@/lib/devicePin";
import type { Device } from "@/lib/types";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function relativeTime(value: string | null | undefined) {
  if (!value) return "Never seen";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `Last seen ${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function signalLabel(rssi: number | null | undefined) {
  if (rssi == null) return "Signal not reported";
  if (rssi >= -55) return `Strong (${rssi} dBm)`;
  if (rssi >= -70) return `Good (${rssi} dBm)`;
  return `Weak (${rssi} dBm)`;
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");

  const refresh = async () => {
    const { data } = await createClient()
      .from("devices")
      .select("*")
      .order("linked_at", { ascending: false });
    setDevices((data ?? []) as Device[]);
  };

  useEffect(() => { void refresh(); }, []);

  async function rename(device: Device) {
    const deviceName = window.prompt("Device nickname", device.device_name);
    if (!deviceName?.trim()) return;
    const response = await fetch(`/api/devices/${device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_name: deviceName }),
    });
    if (!response.ok) setError("Could not rename device.");
    else void refresh();
  }

  async function unlink(device: Device) {
    // PIN-locked bands are unlinked from the security page, where the PIN is entered in a masked field.
    if (device.pin_locked) return router.push(`/account/devices/${device.id}/security#unlink`);
    if (!window.confirm(`Unlink ${device.device_name}?`)) return;
    const response = await fetch(`/api/devices/${device.id}/unlink`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) setError(pinErrorMessage(await response.json().catch(() => ({}))) ?? "Could not unlink device.");
    else void refresh();
  }

  return (
    <div className="kiki-devices-page space-y-5 max-w-[860px]">
      <div className="kiki-reference-title">
        <div>
          <p className="eyebrow">My equipment</p>
          <h1 className="page-title mt-1">My devices</h1>
        </div>
        <Link className="kiki-add-device" href="/account/devices/link"><PlusCircle size={15} /> Link device</Link>
      </div>

      {error && <p role="alert" className="text-[12px] text-[var(--crit)]">{error}</p>}

      {devices.length === 0 ? (
        <section className="kiki-empty-device">
          <PlusCircle size={25} /><h2>Have a backup device?</h2><p>Pair a Kiki Smart Pendant or Keyring tracker.</p><Link href="/account/devices/link">Pair Secondary Tracker</Link>
        </section>
      ) : (
        devices.map((device) => (
          <section className="kiki-device-card" key={device.id}>
              {(() => {
                const latestSignal = device.telemetry_at ?? device.last_seen_at;
                const isOnline = Boolean(device.active && latestSignal && Date.now() - new Date(latestSignal).getTime() <= ONLINE_WINDOW_MS);
                return <>
              <div className="kiki-device-card-head">
                <div className="flex min-w-0 gap-3">
                  <span className="kiki-device-large"><Image src="/assets/devices-icon-link.png" alt="Linked Kiki device" width={56} height={56} priority /></span>
                  <div className="min-w-0">
                    <h2>{device.device_name}</h2><p>{device.device_id}</p>
                  </div>
                </div>
                <span className={`kiki-active-pill ${device.active ? "is-active" : ""}`}>
                  {isOnline ? "Active" : device.active ? "Offline" : "Inactive"}
                </span>
              </div>
              <div className="kiki-device-telemetry"><div><span>Battery status</span><b><BatteryCharging size={16} />{device.battery == null ? "Not reported" : `${device.battery}% charged`}</b></div><div><span>Device signal</span><b><Wifi size={16} />{isOnline ? signalLabel(device.wifi_rssi) : "Offline"}</b></div></div>
              <p className="kiki-device-meta"><span><Clock3 size={14} />Linked {device.linked_at ? new Date(device.linked_at).toLocaleDateString() : "previously"}</span><b>{relativeTime(latestSignal)}</b></p>
              <div className="kiki-device-actions"><button onClick={() => void rename(device)}>Rename</button><Link href={`/account/devices/${device.id}/security`} title="Band PIN and security"><Lock size={14} />{device.pin_locked ? "PIN on" : "Set PIN"}</Link><button onClick={() => void unlink(device)} title="Unlink device"><Trash2 size={16} /></button></div>
              </>;
              })()}
          </section>
        ))
      )}
    </div>
  );
}