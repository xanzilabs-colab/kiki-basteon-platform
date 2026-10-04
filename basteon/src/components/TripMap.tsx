"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";

type Point = { lat: number; lng: number };

function FitRoute({ points, recenter }: { points: Point[]; recenter: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points.map((point) => [point.lat, point.lng]), { paddingTopLeft: [32, 110], paddingBottomRight: [32, 32] });
  }, [map, points, recenter]);
  return null;
}

export default function TripMap({ points, position, recenter = 0 }: { points: Point[]; position?: Point | null; recenter?: number }) {
  const center: [number, number] = points.length ? [points[0].lat, points[0].lng] : [-26.2041, 28.0473];
  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom={false} zoomControl={false} className="hamba-map">
      <TileLayer url={process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} attribution={process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors"} />
      <FitRoute points={points} recenter={recenter} />
      {points.length > 1 && <Polyline positions={points.map((point) => [point.lat, point.lng])} pathOptions={{ color: "#54256f", weight: 5 }} />}
      {points[0] && <CircleMarker center={[points[0].lat, points[0].lng]} radius={7} pathOptions={{ color: "#54256f", fillColor: "#54256f", fillOpacity: 1 }} />}
      {points.at(-1) && <CircleMarker center={[points.at(-1)!.lat, points.at(-1)!.lng]} radius={8} pathOptions={{ color: "#d94362", fillColor: "#d94362", fillOpacity: 1 }} />}
      {position && <CircleMarker center={[position.lat, position.lng]} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#4fa77a", fillOpacity: 1 }} />}
    </MapContainer>
  );
}