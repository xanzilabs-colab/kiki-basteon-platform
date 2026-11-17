"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayers";

export type SafetyMapPoint = { lat: number; lng: number; id?: string; kind?: "spot" | "report" };

function isValidPoint(point: SafetyMapPoint | null | undefined): point is SafetyMapPoint {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180);
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
  className = "",
}: {
  center: SafetyMapPoint | null;
  points?: SafetyMapPoint[];
  layer?: MapBaseLayerName;
  zoom?: number;
  recenter?: number;
  className?: string;
}) {
  const selectedLayer = useMemo(() => MAP_BASE_LAYERS.find((item) => item.name === layer) ?? MAP_BASE_LAYERS[0], [layer]);
  const safeCenter = isValidPoint(center) ? center : null;
  const mapCenter: [number, number] = safeCenter ? [safeCenter.lat, safeCenter.lng] : [-29, 24];
  const validPoints = points.filter(isValidPoint);
  return <div className={`kiki-safety-map ${className}`.trim()}>
    <MapContainer center={mapCenter} zoom={safeCenter ? zoom : 5} scrollWheelZoom attributionControl={false} zoomControl={false} className="kiki-safety-map-canvas">
      <TileLayer url={selectedLayer.url} attribution={selectedLayer.attribution} maxZoom={selectedLayer.maxZoom} />
      <MapViewport center={safeCenter} zoom={zoom} recenter={recenter} />
      {safeCenter && <CircleMarker center={mapCenter} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#4A2472", fillOpacity: 1 }} />}
      {validPoints.map((point, index) => <CircleMarker
        key={point.id ?? `${point.kind ?? "point"}-${point.lat}-${point.lng}-${index}`}
        center={[point.lat, point.lng]}
        radius={point.kind === "report" ? 7 : 6}
        pathOptions={{
          color: "#fff",
          weight: 2,
          fillColor: point.kind === "report" ? "#b4233d" : "#4A2472",
          fillOpacity: 1,
        }}
      />)}
    </MapContainer>
    <small className="kiki-map-attribution">{selectedLayer.attribution}</small>
  </div>;
}
