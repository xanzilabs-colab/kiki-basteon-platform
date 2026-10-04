"use client";

import Image from "next/image";
import Link from "next/link";
import { BatteryCharging, Clock3, PlusCircle, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
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
    if (!window.confirm(`Unlink ${device.device_name}?`)) return;
    const response = await fetch(`/api/devices/${device.id}/unlink`, { method: "POST" });
    if (!response.ok) setError("Could not unlink device.");
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
              <div className="kiki-device-card-head">
                <div className="flex min-w-0 gap-3">
                  <span className="kiki-device-large"><Image src="/assets/devices-icon-link.png" alt="Linked Kiki device" width={56} height={56} priority /></span>
                  <div className="min-w-0">
                    <h2>{device.device_name}</h2><p>{device.device_id}</p>
                  </div>
                </div>
                <span className={`kiki-active-pill ${device.active ? "is-active" : ""}`}>
                  {device.active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="kiki-device-telemetry"><div><span>Battery status</span><b><BatteryCharging size={16} />Device ready</b></div><div><span>Bluetooth signal</span><b><Wifi size={16} />{device.active ? "Connected" : "Unavailable"}</b></div></div>
              <p className="kiki-device-meta"><span><Clock3 size={14} />Linked {device.linked_at ? new Date(device.linked_at).toLocaleDateString() : "previously"}</span><b>{device.last_seen_at ? `Last seen ${new Date(device.last_seen_at).toLocaleString()}` : "Never seen"}</b></p>
              <div className="kiki-device-actions"><button onClick={() => void rename(device)}>Rename</button><button onClick={() => void unlink(device)} title="Unlink device"><Trash2 size={16} /></button></div>
          </section>
        ))
      )}
    </div>
  );
}