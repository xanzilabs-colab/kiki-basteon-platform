"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]); const [error, setError] = useState("");
  const refresh = async () => { const { data } = await createClient().from("devices").select("*").order("linked_at", { ascending: false }); setDevices((data ?? []) as Device[]); };
  useEffect(() => { void refresh(); }, []);
  async function rename(device: Device) { const deviceName = window.prompt("Device nickname", device.device_name); if (!deviceName?.trim()) return; const response = await fetch(`/api/devices/${device.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_name: deviceName }) }); if (!response.ok) setError("Could not rename device."); else void refresh(); }
  async function unlink(device: Device) { if (!window.confirm(`Unlink ${device.device_name}?`)) return; const response = await fetch(`/api/devices/${device.id}/unlink`, { method: "POST" }); if (!response.ok) setError("Could not unlink device."); else void refresh(); }
  return <div className="space-y-4"><div className="flex items-end justify-between gap-3"><div><p className="eyebrow">My equipment</p><h1 className="page-title mt-1">My devices</h1></div><Link className="btn btn-primary inline-flex items-center" href="/account/devices/link">Link device</Link></div>{error && <p role="alert" className="text-xs text-[var(--crit)]">{error}</p>}{devices.length === 0 ? <section className="panel p-4"><p className="muted">No devices linked yet.</p></section> : devices.map((device) => <section className="panel p-4" key={device.id}><div className="flex justify-between gap-3"><div><h2 className="font-semibold">{device.device_name}</h2><p className="data text-xs muted mt-1">{device.device_id}</p></div><span className={`status ${device.active ? "status-green" : "status-gray"}`}>{device.active ? "Active" : "Inactive"}</span></div><p className="muted text-xs mt-3">Linked {device.linked_at ? new Date(device.linked_at).toLocaleDateString() : "previously"} · Last seen {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : "Never"}</p><div className="flex gap-2 mt-4"><button className="btn" onClick={() => void rename(device)}>Rename</button><button className="btn btn-danger" onClick={() => void unlink(device)}>Unlink</button></div></section>)}</div>;
}