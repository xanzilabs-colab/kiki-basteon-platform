"use client";

import { useEffect, useMemo } from "react";
import * as L from "leaflet";
import { useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayers";

export type SafetyMapPoint = {
  lat: number;
  lng: number;
  id?: string;
  kind?: "spot" | "report" | "buddy";
  category?: string;
  createdAt?: string;
  upvotes?: number;
  name?: string;
  avatarUrl?: string | null;
  subtitle?: string | null;
  description?: string | null;
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

function ReportRiskZones({ points }: { points: SafetyMapPoint[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const updateZoom = () => setZoom(map.getZoom());
    map.on("zoomend", updateZoom);
    return () => { map.off("zoomend", updateZoom); };
  }, [map]);

  const zones = useMemo(() => {
    const latitudeStep = zoom >= 12 ? 0.002 : zoom >= 9 ? 0.008 : 0.03;
    const cells = new Map<string, { south: number; west: number; north: number; east: number; weight: number }>();
    for (const point of points) {
      const longitudeStep = latitudeStep / Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
      const row = Math.floor(point.lat / latitudeStep);
      const column = Math.floor(point.lng / longitudeStep);
      const key = `${row}:${column}`;
      const cell = cells.get(key) ?? {
        south: row * latitudeStep,
        west: column * longitudeStep,
        north: (row + 1) * latitudeStep,
        east: (column + 1) * longitudeStep,
        weight: 0,
      };
      cell.weight += reportSeverity[point.category ?? ""] ?? 0.62;
      cells.set(key, cell);
    }
    return Array.from(cells.values()).map((cell) => ({
      ...cell,
      color: cell.weight >= 3 ? "#e84e4e" : cell.weight >= 2 ? "#f69a47" : cell.weight >= 1.4 ? "#f0b84c" : "#f0d95d",
      opacity: Math.min(0.27, 0.12 + cell.weight * 0.035),
    }));
  }, [points, zoom]);

  useEffect(() => {
    if (!zones.length) return;
    const layer = L.featureGroup();
    zones.forEach((zone) => {
      L.polygon([
        [zone.south, zone.west],
        [zone.south, zone.east],
        [zone.north, zone.east],
        [zone.north, zone.west],
      ], {
        stroke: false,
        fillColor: zone.color,
        fillOpacity: zone.opacity,
        interactive: false,
        className: "kiki-risk-zone",
      }).addTo(layer);
    });
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, zones]);

  return null;
}

function MapViewport({ center, zoom, recenter, fitPoints }: { center: SafetyMapPoint | null; zoom: number; recenter: number; fitPoints?: SafetyMapPoint[] }) {
  const map = useMap();
  const previousRecenter = useRef(recenter);
  useEffect(() => {
    const shouldRecenter = previousRecenter.current !== recenter;
    previousRecenter.current = recenter;
    if (shouldRecenter && center && isValidPoint(center)) {
      map.setView([center.lat, center.lng], zoom);
      return;
    }
    if (fitPoints?.length) {
      const bounds = L.latLngBounds(fitPoints.map((point) => L.latLng(point.lat, point.lng)));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: zoom, animate: false });
      return;
    }
    if (center && isValidPoint(center)) map.setView([center.lat, center.lng], zoom);
  }, [center, fitPoints, map, zoom, recenter]);
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
  fitPoints,
  userLocation,
  profileImageUrl = null,
  profileLabel = "Kiki",
  userLocationStyle = "avatar",
  onPointSelect,
  className = "",
}: {
  center: SafetyMapPoint | null;
  points?: SafetyMapPoint[];
  layer?: MapBaseLayerName;
  zoom?: number;
  recenter?: number;
  fitPoints?: SafetyMapPoint[];
  userLocation?: SafetyMapPoint | null;
  profileImageUrl?: string | null;
  profileLabel?: string;
  userLocationStyle?: "avatar" | "dot";
  onPointSelect?: (point: SafetyMapPoint) => void;
  className?: string;
}) {
  const selectedLayer = useMemo(() => MAP_BASE_LAYERS.find((item) => item.name === layer) ?? MAP_BASE_LAYERS[0], [layer]);
  const safeCenter = isValidPoint(center) ? center : null;
  const markerLocation = userLocation === undefined ? safeCenter : isValidPoint(userLocation) ? userLocation : null;
  const mapCenter: [number, number] = safeCenter ? [safeCenter.lat, safeCenter.lng] : [-29, 24];
  const validPoints = useMemo(() => points.filter(isValidPoint), [points]);
  const reports = useMemo(() => validPoints.filter((point) => point.kind === "report"), [validPoints]);
  const userIcon = useMemo(() => {
    if (userLocationStyle === "dot") {
      return L.divIcon({
        className: "kiki-user-map-marker location-dot",
        html: '<span class="kiki-user-location-dot" aria-hidden="true"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
    }
    const imageUrl = safeImageSource(profileImageUrl);
    const initials = escapeHtml(profileLabel.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "K");
    const content = imageUrl
      ? `<img src="${imageUrl}" alt="" />`
      : `<span aria-hidden="true">${initials}</span>`;
    return L.divIcon({
      className: "kiki-user-map-marker",
      html: `<span class="kiki-user-map-avatar">${content}</span>`,
      iconSize: [72, 72],
      iconAnchor: [36, 36],
    });
  }, [profileImageUrl, profileLabel, userLocationStyle]);
  return <div className={`kiki-safety-map ${className}`.trim()}>
    <MapContainer center={mapCenter} zoom={safeCenter ? zoom : 5} scrollWheelZoom attributionControl={false} zoomControl={false} className="kiki-safety-map-canvas">
      <TileLayer url={selectedLayer.url} attribution={selectedLayer.attribution} maxZoom={selectedLayer.maxZoom} />
      <MapViewport center={safeCenter} zoom={zoom} recenter={recenter} fitPoints={fitPoints} />
      {markerLocation && <Marker position={[markerLocation.lat, markerLocation.lng]} icon={userIcon} title={`${profileLabel}'s location`} />}
      <ReportRiskZones points={reports} />
      {validPoints.filter((point) => point.kind === "buddy").map((point, index) => {
        const imageUrl = safeImageSource(point.avatarUrl);
        const initials = escapeHtml(point.name?.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "?");
        const content = imageUrl
          ? `<img src="${imageUrl}" alt="" />`
          : `<span aria-hidden="true">${initials}</span>`;
        const marker = L.divIcon({
          className: "kiki-safety-point-marker buddy",
          html: `<span class="kiki-buddy-map-avatar">${content}</span>`,
          iconSize: [50, 50],
          iconAnchor: [25, 25],
        });
        return <Marker
          key={point.id ?? `buddy-${point.lat}-${point.lng}-${index}`}
          position={[point.lat, point.lng]}
          icon={marker}
          title={`${point.name ?? "Buddy"} shared their live location`}
          eventHandlers={onPointSelect ? { click: () => onPointSelect(point) } : undefined}
        />;
      })}
      {reports.map((point, index) => {
        const markerGlyph = reportGlyphs[point.category ?? ""] ?? "!";
        const categoryClass = ["unsafe_area", "poor_lighting", "harassment", "road_hazard"].includes(point.category ?? "")
          ? ` kind-${point.category}`
          : "";
        const marker = L.divIcon({
          className: `kiki-safety-point-marker report${categoryClass}`,
          html: `<span class="kiki-safety-point-marker-inner" aria-hidden="true"><span>${markerGlyph}</span></span>`,
          iconSize: [50, 50],
          iconAnchor: [25, 25],
        });
        return <Marker
          key={point.id ?? `report-${point.lat}-${point.lng}-${index}`}
          position={[point.lat, point.lng]}
          icon={marker}
          title={`${point.name ?? point.category?.replaceAll("_", " ") ?? "Community"} report`}
          eventHandlers={onPointSelect ? { click: () => onPointSelect(point) } : undefined}
        />;
      })}
      {validPoints.filter((point) => point.kind === "spot").map((point, index) => {
        const markerGlyph = spotGlyphs[point.category ?? ""] ?? "•";
        const marker = L.divIcon({
          className: "kiki-safety-point-marker spot",
          html: `<span class="kiki-safety-point-marker-inner" aria-hidden="true"><span>${markerGlyph}</span></span>`,
          iconSize: [50, 50],
          iconAnchor: [25, 25],
        });
        return <Marker
          key={point.id ?? `spot-${point.lat}-${point.lng}-${index}`}
          position={[point.lat, point.lng]}
          icon={marker}
          title={point.name ?? `${point.category?.replaceAll("_", " ") ?? "Safe"} spot`}
          eventHandlers={onPointSelect ? { click: () => onPointSelect(point) } : undefined}
        />;
      })}
    </MapContainer>
    <small className="kiki-map-attribution">{selectedLayer.attribution}</small>
  </div>;
}
