"use client";

import { useEffect, useMemo, useState } from "react";
import { Bluetooth, RefreshCw, Search, Smartphone, Unlink } from "lucide-react";
import type { Device } from "@/lib/types";
import { DeviceTable } from "@/components/DeviceTable";
import { RegisterDeviceDialog } from "@/components/RegisterDeviceDialog";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all"); const [search, setSearch] = useState("");
  const refresh = async () => { setLoading(true); setError(""); try { const response = await fetch("/api/admin/devices", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load devices."); setDevices(body as Device[]); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Could not load devices."); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const physicalDevices = useMemo(() => devices.filter((device) => !device.is_virtual), [devices]);
  const displayed = useMemo(() => { const needle = search.trim().toLowerCase(); return physicalDevices.filter((device) => { const ownership = filter === "all" || (filter === "linked" ? Boolean(device.user_id) : !device.user_id); const searchable = [device.device_id, device.device_name, device.owner?.full_name, device.owner?.email].filter(Boolean).join(" ").toLowerCase(); return ownership && (!needle || searchable.includes(needle)); }); }, [physicalDevices, filter, search]);
  const linked = physicalDevices.filter((device) => device.user_id).length; const active = physicalDevices.filter((device) => device.active).length;
  const virtualCount = devices.length - physicalDevices.length;
  const metrics = [{ label: "Registered", value: physicalDevices.length, note: "Kiki hardware in fleet" }, { label: "Linked", value: linked, note: `${Math.max(physicalDevices.length - linked, 0)} awaiting an owner` }, { label: "Active", value: active, note: `${Math.max(physicalDevices.length - active, 0)} inactive` }];

  return <div className="admin-page">
    <header className="admin-page-heading"><div><h1>Devices</h1><p>Register, assign and maintain the Kiki devices connected to your platform.</p></div><RegisterDeviceDialog refresh={refresh} /></header>
    <section className="admin-panel admin-kpi-grid admin-kpi-three">{metrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</section>
    <section className="panel admin-inventory-panel">
      <div className="pane-head"><div><span>Device inventory</span><p>{displayed.length} of {physicalDevices.length} physical devices shown</p></div><button className="btn admin-small-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button></div>
      <div className="admin-inventory-toolbar"><label className="admin-inventory-search"><Search size={17} /><input className="input" placeholder="Search device, owner or email" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="tabs"><button className="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All <span className="data">{physicalDevices.length}</span></button><button className="tab" aria-selected={filter === "linked"} onClick={() => setFilter("linked")}>Linked <span className="data">{linked}</span></button><button className="tab" aria-selected={filter === "unlinked"} onClick={() => setFilter("unlinked")}>Unlinked <span className="data">{physicalDevices.length - linked}</span></button></div></div>
      {virtualCount > 0 && <p className="admin-inventory-note"><Bluetooth size={14} />{virtualCount} phone trigger {virtualCount === 1 ? "endpoint is" : "endpoints are"} managed separately and excluded from the Kiki hardware fleet.</p>}
      {error && <div role="alert" className="admin-status admin-status-error">Could not load devices: {error}</div>}
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-11 animate-pulse bg-[var(--surface-2)]" />)}</div> : physicalDevices.length === 0 ? <div className="admin-empty"><Smartphone size={24} /><strong>No Kiki devices registered yet</strong><span>Phone triggers are not physical Kiki hardware. Register a Kiki device to add it to the fleet.</span></div> : displayed.length === 0 ? <div className="admin-empty"><Unlink size={24} /><strong>No matching devices</strong><span>Change the search or ownership filter to see other registered devices.</span></div> : <DeviceTable devices={displayed} refresh={refresh} />}
    </section>
  </div>;
}