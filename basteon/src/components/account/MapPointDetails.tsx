"use client";

import { AlertTriangle, Building2, MapPin, UsersRound, X } from "lucide-react";
import type { SafetyMapPoint } from "@/components/KikiSafetyMap";

const kindLabels = {
  buddy: "Buddy location",
  report: "Pulse report",
  spot: "Safe Haven",
} as const;

function titleFor(point: SafetyMapPoint) {
  if (point.name) return point.name;
  return point.category?.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? "Map location";
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MapPointDetails({
  point,
  onClose,
  onAction,
  actionLabel,
}: {
  point: SafetyMapPoint;
  onClose: () => void;
  onAction?: () => void;
  actionLabel?: string;
}) {
  const Icon = point.kind === "buddy" ? UsersRound : point.kind === "spot" ? Building2 : AlertTriangle;
  const time = point.createdAt ? formatTime(point.createdAt) : "";

  return <section className="kiki-map-point-details" aria-label={`${kindLabels[point.kind ?? "report"]} details`}>
    <div className="kiki-map-point-details-heading">
      <span className={`kiki-map-point-details-icon is-${point.kind ?? "report"}`}><Icon size={19} aria-hidden="true" /></span>
      <div>
        <small>{kindLabels[point.kind ?? "report"]}</small>
        <h2>{titleFor(point)}</h2>
        {point.subtitle && <p><MapPin size={13} aria-hidden="true" />{point.subtitle}</p>}
      </div>
      <button type="button" aria-label="Close map details" onClick={onClose}><X size={17} aria-hidden="true" /></button>
    </div>
    {point.description && <p className="kiki-map-point-details-description">{point.description}</p>}
    {(time || point.upvotes !== undefined) && <div className="kiki-map-point-details-meta">
      {time && <time dateTime={point.createdAt}>{time}</time>}
      {point.upvotes !== undefined && <span>{point.upvotes} found helpful</span>}
    </div>}
    {onAction && actionLabel && <button type="button" className="kiki-map-point-details-action" onClick={onAction}>{actionLabel}</button>}
  </section>;
}
