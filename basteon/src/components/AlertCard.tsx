"use client";

import { formatDistanceToNow } from "date-fns";
import { formatDistance, hasLocation, haversineKm, type Position } from "@/lib/geo";
import { locationHealth } from "@/lib/locationTracking";
import type { Alert } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { LocationSourceBadge } from "./LocationSourceBadge";
import { AlertTypeBadge } from "./alerts/AlertTypeBadge";
import { isMovingAlert, movementLabel } from "@/lib/motion";
import { alertDeviceLabel, alertOwnerName } from "@/lib/alertDisplay";
import { Bluetooth } from "lucide-react";

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
  const movement = movementLabel(alert);

  return (
    <button
      onClick={onSelect}
      aria-selected={selected}
      className={`row ${alert.status === "new" ? "sev-new" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={alert.status} />
        <AlertTypeBadge typeCode={alert.type_code} />
        {alert.trigger_source === "bt_media" && <span className="inline-flex items-center gap-1 text-[10px] text-[var(--info)]"><Bluetooth size={11} />Bluetooth</span>}
        {alert.duress && <span className="text-[10px] font-semibold text-[var(--crit)]">Duress</span>}
        <span className="data text-[11px] muted">
          {formatDistanceToNow(new Date(alert.triggered_at), { addSuffix: true })}
        </span>
      </div>
      <p className="row-title truncate">{alertDeviceLabel(alert)}</p>
      <div className="row-meta">
        <span className="truncate">{alertOwnerName(alert) ?? "Unassigned"}</span>
        {km != null && <span className="data whitespace-nowrap">{formatDistance(km)}</span>}
        <span className="data">{alert.battery == null ? "—" : `${alert.battery}%`}</span>
      </div>
      <div className="row-meta">
        <span className={`truncate ${isMovingAlert(alert) ? "text-[var(--warn)]" : "muted"}`}>{movement}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <LocationSourceBadge alert={alert} />
        <span className={`data text-[10px] ${healthColor}`}>{healthText}</span>
      </div>
    </button>
  );
}