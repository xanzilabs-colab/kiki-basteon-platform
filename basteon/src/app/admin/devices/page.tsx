"use client";

import { useEffect, useMemo, useState } from "react";
import type { Device } from "@/lib/types";
import { DeviceTable } from "@/components/DeviceTable";
import { RegisterDeviceDialog } from "@/components/RegisterDeviceDialog";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/devices", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load devices.");
      setDevices(body as Device[]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load devices.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);
  const displayed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return devices.filter((device) => {
      const ownership = filter === "all" || (filter === "linked" ? Boolean(device.user_id) : !device.user_id);
      const searchable = [device.device_id, device.device_name, device.owner?.full_name, device.owner?.email].filter(Boolean).join(" ").toLowerCase();
      return ownership && (!needle || searchable.includes(needle));
    });
  }, [devices, filter, search]);

  return <div className="space-y-4"><div className="flex items-end justify-between gap-3"><div><p className="eyebrow">Fleet</p><h1 className="page-title mt-1">Devices</h1></div><RegisterDeviceDialog refresh={refresh} /></div><div className="flex flex-col sm:flex-row gap-2"><input className="input sm:max-w-sm" placeholder="Search ID, name, owner, or email" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="tabs sm:w-72"><button className="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All</button><button className="tab" aria-selected={filter === "linked"} onClick={() => setFilter("linked")}>Linked</button><button className="tab" aria-selected={filter === "unlinked"} onClick={() => setFilter("unlinked")}>Unlinked</button></div></div>{error && <div role="alert" className="border border-[#6b2b32] bg-[rgb(255_77_90/.08)] p-3 text-sm text-[var(--crit)]">Could not load devices: {error}</div>}{loading ? <div className="tbl-wrap"><div className="p-4 space-y-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-8 bg-[var(--surface-2)] animate-pulse" />)}</div></div> : devices.length === 0 ? <section className="panel p-5"><p className="font-medium">No devices registered yet</p><p className="muted text-xs mt-1">Register a band before it can be linked to a user.</p></section> : <DeviceTable devices={displayed} refresh={refresh} />}</div>;
}