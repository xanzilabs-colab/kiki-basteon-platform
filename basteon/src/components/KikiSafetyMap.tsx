"use client";

import { Fragment, useEffect, useMemo } from "react";
import { divIcon } from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayers";

export type SafetyMapPoint = {
  lat: number;
  lng: number;
  id?: string;
  kind?: "spot" | "report";
  category?: string;
  createdAt?: string;
  upvotes?: number;
};

const spotGlyphs: Record<string, string> = {
  petrol_station: "P",
  mall: "M",
  police_station: "S",
  hospital: "+",
  cafe_restaurant: "C",
  transit_hub: "T",
  other_public: "•",
  supermarket: "G",
  school: "E",
  place_of_worship: "W",
  bus_stop: "B",
  taxi_rank: "T",
};

const reportGlyphs: Record<string, string> = {
  unsafe_area: "!",
  poor_lighting: "☼",
  harassment: "H",
  road_hazard: "⚠",
};

const reportSeverity: Record<string, number> = {
  unsafe_area: 1,
  harassment: 1,
  road_hazard: 0.72,
  poor_lighting: 0.48,
};

function isValidPoint(point: SafetyMapPoint | null | undefined): point is SafetyMapPoint {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180);
}

function escapeHtml(value: string) {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}

function safeImageSource(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://kiki.local");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return escapeHtml(value);
  } catch {
    return null;
  }
}

function MapViewport({ center, zoom, recenter }: { center: SafetyMapPoint | null; zoom: number; recenter: number }) {
  const map = useMap();
  useEffect(() => {
    if (center && isValidPoint(center)) map.setView([center.lat, center.lng], zoom);
  }, [center, map, zoom, recenter]);
  useEffect(() => {
    const element = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false }));
    observer.observe(element);
    map.invalidateSize({ animate: false, pan: false });
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function KikiSafetyMap({
  center,
  points = [],
  layer = "Street",
  zoom = 13,
  recenter = 0,
  profileImageUrl = null,
  profileLabel = "Kiki",
  className = "",
}: {
  center: SafetyMapPoint | null;
  points?: SafetyMapPoint[];
  layer?: MapBaseLayerName;
  zoom?: number;
  recenter?: number;
  profileImageUrl?: string | null;
  profileLabel?: string;
  className?: string;
}) {
  const selectedLayer = useMemo(() => MAP_BASE_LAYERS.find((item) => item.name === layer) ?? MAP_BASE_LAYERS[0], [layer]);
  const safeCenter = isValidPoint(center) ? center : null;
  const mapCenter: [number, number] = safeCenter ? [safeCenter.lat, safeCenter.lng] : [-29, 24];
  const validPoints = points.filter(isValidPoint);
  const reports = validPoints.filter((point) => point.kind === "report");
  const userIcon = useMemo(() => {
    const imageUrl = safeImageSource(profileImageUrl);
    const initials = escapeHtml(profileLabel.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "K");
    const content = imageUrl
      ? `<img src="${imageUrl}" alt="" />`
      : `<span aria-hidden="true">${initials}</span>`;
    return divIcon({
      className: "kiki-user-map-marker",
      html: `<span class="kiki-user-map-avatar">${content}</span>`,
      iconSize: [72, 72],
      iconAnchor: [36, 36],
    });
  }, [profileImageUrl, profileLabel]);
  return <div className={`kiki-safety-map ${className}`.trim()}>
    <MapContainer center={mapCenter} zoom={safeCenter ? zoom : 5} scrollWheelZoom attributionControl={false} zoomControl={false} className="kiki-safety-map-canvas">
      <TileLayer url={selectedLayer.url} attribution={selectedLayer.attribution} maxZoom={selectedLayer.maxZoom} />
      <MapViewport center={safeCenter} zoom={zoom} recenter={recenter} />
      {safeCenter && <Marker position={mapCenter} icon={userIcon} title={`${profileLabel}'s location`} />}
      {reports.map((point, index) => {
        const ageDays = point.createdAt ? Math.max(0, (Date.now() - Date.parse(point.createdAt)) / 86_400_000) : 30;
        const freshness = Number.isFinite(ageDays) ? Math.exp(-ageDays / 30) : 0.25;
        const severity = reportSeverity[point.category ?? ""] ?? 0.62;
        const support = Math.min(1.3, 1 + Math.max(0, point.upvotes ?? 0) * 0.06);
        const intensity = Math.min(1, freshness * severity * support);
        const color = intensity > 0.62 ? "#b4233d" : intensity > 0.32 ? "#df793e" : "#d3ad45";
        const radius = 180 + intensity * 220;
        const markerGlyph = reportGlyphs[point.category ?? ""] ?? "!";
        const marker = divIcon({
          className: "kiki-safety-point-marker report",
          html: `<span class="kiki-safety-point-marker-inner" aria-hidden="true"><span>${markerGlyph}</span></span>`,
          iconSize: [36, 42],
          iconAnchor: [18, 38],
        });
        return <Fragment key={point.id ?? `report-${point.lat}-${point.lng}-${index}`}>
          <Circle
            center={[point.lat, point.lng]}
            radius={radius}
            interactive={false}
            pathOptions={{ color, weight: 1, opacity: 0.16 + intensity * 0.18, fillColor: color, fillOpacity: 0.06 + intensity * 0.12 }}
          />
          <Marker position={[point.lat, point.lng]} icon={marker} title={`${point.category?.replaceAll("_", " ") ?? "Community"} report`} />
        </Fragment>;
      })}
      {validPoints.filter((point) => point.kind === "spot").map((point, index) => {
        const markerGlyph = spotGlyphs[point.category ?? ""] ?? "•";
        const marker = divIcon({
          className: "kiki-safety-point-marker spot",
          html: `<span class="kiki-safety-point-marker-inner" aria-hidden="true"><span>${markerGlyph}</span></span>`,
          iconSize: [36, 42],
          iconAnchor: [18, 38],
        });
        return <Marker
          key={point.id ?? `spot-${point.lat}-${point.lng}-${index}`}
          position={[point.lat, point.lng]}
          icon={marker}
          title={`${point.category?.replaceAll("_", " ") ?? "Safe"} spot`}
        />;
      })}
    </MapContainer>
    <small className="kiki-map-attribution">{selectedLayer.attribution}</small>
  </div>;
}
