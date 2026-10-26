"use client";

import { formatDistance, hasLocation, haversineKm, type Position } from "@/lib/geo";
import { locationHealth } from "@/lib/locationTracking";
import type { Alert } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { LocationSourceBadge } from "./LocationSourceBadge";
import { AlertTypeBadge } from "./alerts/AlertTypeBadge";
import { isMovingAlert, movementLabel } from "@/lib/motion";
import { alertDeviceLabel, alertOwnerName } from "@/lib/alertDisplay";
import { Bluetooth, X } from "lucide-react";
import { describeTriggerPattern } from "@/lib/triggerDisplay";
import { fmtRelativeTime } from "@/lib/datetime";
import { activeStatuses } from "@/lib/status";

export function AlertCard({
  alert,
  me,
  selected,
  onSelect,
  onDismiss,
  dismissed = false,
  relativeTimeNow = new Date(),
}: {
  alert: Alert;
  me: Position | null;
  selected: boolean;
  onSelect(): void;
  onDismiss?(alert: Alert): void;
  dismissed?: boolean;
  relativeTimeNow?: Date;
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
  const canDismiss = Boolean(onDismiss && !dismissed && activeStatuses.includes(alert.status));
  const showDismissState = canDismiss || dismissed;

  return (
    <div className="relative">
      <button
        onClick={onSelect}
        aria-selected={selected}
        className={`row ${alert.status === "new" ? "sev-new" : ""} ${showDismissState ? "pb-11" : ""}`}
      >
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={alert.status} />
          <AlertTypeBadge typeCode={alert.type_code} />
          {(alert.trigger_source === "bt_media" || alert.trigger_source === "bt_ble") && <span className="inline-flex items-center gap-1 text-[10px] text-[var(--info)]"><Bluetooth size={11} />Bluetooth</span>}
          {alert.duress && <span className="text-[10px] font-semibold text-[var(--crit)]">Duress</span>}
          <span className="data text-[11px] muted">
            {fmtRelativeTime(alert.triggered_at, relativeTimeNow)}
          </span>
        </div>
        <p className="row-title truncate">{alertDeviceLabel(alert)}</p>
        {alert.trigger_pattern && <p className="truncate text-left text-[10px] text-[var(--muted)]">{describeTriggerPattern(alert.trigger_pattern)}</p>}
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
      {canDismiss && onDismiss && (
        <button
          type="button"
          className="btn absolute bottom-2 right-3 z-10 inline-flex h-7 items-center gap-1 px-2 text-[10px]"
          aria-label="Remove alert from your active queue"
          title="This only removes the alert from your active queue"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss(alert);
          }}
        >
          <X size={12} />Remove from active
        </button>
      )}
      {dismissed && <span className="absolute bottom-3 right-3 text-[10px] text-[var(--muted)]">Removed from active</span>}
    </div>
  );
}