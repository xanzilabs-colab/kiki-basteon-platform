"use client";
import { Copy, ExternalLink, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Alert, AlertEvent } from "@/lib/types";
import { locationAgeMs, locationHealth } from "@/lib/locationTracking";
import { StatusBadge } from "./StatusBadge";
import { LocationSourceBadge } from "./LocationSourceBadge";
import { StatusActions } from "./StatusActions";
import { AlertTimeline } from "./AlertTimeline";

export function AlertDetailPanel({ alert, events, admin, refresh }: { alert: Alert | null; events: AlertEvent[]; admin?: boolean; refresh(): void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!alert) return <div className="p-6"><p className="label">No selection</p><p className="muted text-xs mt-1">Select an alert to view response details.</p></div>;
  const coords = alert.lat == null || alert.lng == null ? null : `${alert.lat.toFixed(6)}, ${alert.lng.toFixed(6)}`;
  const ageSeconds = Math.floor(locationAgeMs(alert, now) / 1000);
  const health = locationHealth(alert, now);
  const healthText = health === "live" ? "LIVE" : health === "delayed" ? "SIGNAL DELAYED" : "NO SIGNAL";
  const healthColor = health === "live" ? "text-[var(--ok)]" : health === "delayed" ? "text-[var(--warn)]" : "text-[var(--crit)]";

  return (
    <div className="flex flex-col min-h-full">
      <div className="pane-head"><StatusBadge status={alert.status} /><span className="data">#{alert.ctr}</span></div>

      <div className="section">
        <h2 className="text-[15px] font-semibold">{alert.device?.device_name ?? alert.device_id}</h2>
        <p className="muted text-xs mt-0.5">{alert.device?.owner?.full_name ?? "No owner assigned"}</p>
        {alert.device?.owner?.phone && (
          <a className="btn mt-3 inline-flex items-center gap-2 !text-[var(--accent)]" href={`tel:${alert.device.owner.phone}`}>
            <Phone size={13} /><span className="data">{alert.device.owner.phone}</span>
          </a>
        )}
      </div>

      <div className="section space-y-2">
        <span className="label">Location</span>
        <div className="flex items-center justify-between gap-2"><LocationSourceBadge alert={alert} /><span className={`data text-[11px] ${healthColor}`}>{healthText}</span></div>
        <div className="kv"><span className="muted text-xs">Last update</span><span className={`data ${healthColor}`}>{ageSeconds}s ago</span></div>
        {coords ? (
          <>
            <div className="kv">
              <span className="data text-[12px]">{coords}</span>
              <button className="btn !px-2" title="Copy coordinates" onClick={() => { void navigator.clipboard.writeText(coords); toast.success("Coordinates copied"); }}><Copy size={13} /></button>
            </div>
            <a className="btn w-full inline-flex items-center justify-center gap-2" target="_blank" rel="noreferrer"
               href={`https://www.google.com/maps/dir/?api=1&destination=${alert.lat},${alert.lng}`}>
              <ExternalLink size={13} />Navigate
            </a>
          </>
        ) : <p className="text-[var(--crit)] text-xs">No GPS fix available for this alert.</p>}
      </div>

      <div className="section">
        <div className="kv"><span className="label">Battery</span><span className="data">{alert.battery == null ? "--" : `${alert.battery}%`}</span></div>
        <div className="kv mt-2"><span className="label">Location updates</span><span className="data">{alert.update_count ?? 0}</span></div>
      </div>

      <div className="section flex-1">
        <span className="label block mb-3">Timeline</span>
        <AlertTimeline events={events.filter((e) => e.alert_id === alert.id)} />
      </div>

      <div className="section sticky bottom-0 bg-[var(--surface)] border-t border-[var(--line-strong)] border-b-0">
        <StatusActions alert={alert} admin={admin} onChanged={refresh} />
      </div>
    </div>
  );
}