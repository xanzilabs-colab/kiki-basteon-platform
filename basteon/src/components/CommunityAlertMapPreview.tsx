"use client";

import { Navigation } from "lucide-react";
import { reportMapAttribution, reportMapTiles } from "@/lib/buddies/meeting/reportMap";

export function CommunityAlertMapPreview({
  alert,
  distanceLabel,
  onLocate,
}: {
  alert: { lat: number; lng: number; location_label: string | null };
  distanceLabel: string | null;
  onLocate: () => void;
}) {
  const tiles = reportMapTiles(alert.lat, alert.lng);
  const location = alert.location_label || "Nearby area";
  const distance = distanceLabel ? `${distanceLabel} from your location · Tap to view pin` : "Tap to view pin";

  return <button
    type="button"
    className="safe-alert-spatial-preview"
    onClick={onLocate}
    aria-label={`Locate report near ${location} on the map`}
  >
    <span className="safe-alert-map-image" aria-hidden="true">
      {tiles.map((tile) => <img
        key={tile.key}
        src={tile.src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="safe-alert-map-tile"
        style={{
          left: `calc(50% ${tile.left < 0 ? "-" : "+"} ${Math.abs(tile.left)}px)`,
          top: `calc(50% ${tile.top < 0 ? "-" : "+"} ${Math.abs(tile.top)}px)`,
        }}
      />)}
      <span className="safe-alert-map-pin" />
      <span className="safe-alert-map-attribution">{reportMapAttribution}</span>
    </span>
    <span className="safe-alert-spatial-info">
      <span className="safe-alert-spatial-copy">
        <b>{location}</b>
        <small>{distance}</small>
      </span>
      <span className="safe-alert-spatial-navigation" aria-hidden="true"><Navigation size={18} /></span>
    </span>
  </button>;
}
