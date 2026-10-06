"use client";

import { formatDistanceToNow } from "date-fns";
import { formatDistance, hasLocation, haversineKm, type Position } from "@/lib/geo";
import { locationHealth } from "@/lib/locationTracking";
import type { Alert } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { LocationSourceBadge } from "./LocationSourceBadge";
import { AlertTypeBadge } from "./alerts/AlertTypeBadge";

export function AlertCard({
  alert,
  me,
  selected,
  onSelect,
}: {
  alert: Alert;
  me: Position | null;
  selected: boolean;
  onSelect(): void;
}) {
  const km =
    me && hasLocation(alert)
      ? haversineKm(me, { lat: alert.lat!, lng: alert.lng! })
      : null;
  const health = locationHealth(alert);
  const healthText =
    health === "live" ? "LIVE" : health === "delayed" ? "DELAYED" : "NO SIGNAL";
  const healthColor =
    health === "live"
      ? "text-[var(--ok)]"
      : health === "delayed"
      ? "text-[var(--warn)]"
      : "text-[var(--crit)]";

  return (
    <button
      onClick={onSelect}
      aria-selected={selected}
      className={`row ${alert.status === "new" ? "sev-new" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={alert.status} />
        <AlertTypeBadge typeCode={alert.type_code} />
        <span className="data text-[11px] muted">
          {formatDistanceToNow(new Date(alert.triggered_at), { addSuffix: true })}
        </span>
      </div>
      <p className="row-title truncate">{alert.device?.device_name ?? alert.device_id}</p>
      <div className="row-meta">
        <span className="truncate">{alert.device?.owner?.full_name ?? "Unassigned"}</span>
        {km != null && <span className="data whitespace-nowrap">{formatDistance(km)}</span>}
        <span className="data">{alert.battery == null ? "—" : `${alert.battery}%`}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <LocationSourceBadge alert={alert} />
        <span className={`data text-[10px] ${healthColor}`}>{healthText}</span>
      </div>
    </button>
  );
}