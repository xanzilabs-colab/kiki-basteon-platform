"use client";

import { useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";

type Point = { lat: number; lng: number };
type Props = {
  points: Point[];
  position?: Point | null;
  recenter?: number;
  stops?: Point[];
  drawn?: Point[];
  avatarUrl?: string | null;
  initial?: string;
  onMapClick?: (point: Point) => void;
  drawing?: boolean;
  onDraw?: (point: Point) => void;
};

function FitRoute({ points, recenter }: { points: Point[]; recenter: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points.map((point) => [point.lat, point.lng]), { paddingTopLeft: [32, 110], paddingBottomRight: [32, 32] });
  }, [map, points, recenter]);
  return null;
}

function Clicks({ onMapClick }: { onMapClick?: (point: Point) => void }) {
  useMapEvents({ click: (event) => onMapClick?.({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

/** Freehand drawing with mouse, pen or finger. Adds a point whenever the pointer has moved a few pixels. */
function FreeDraw({ active, onDraw }: { active: boolean; onDraw?: (point: Point) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const el = map.getContainer();
    let down = false;
    let last: { x: number; y: number } | null = null;
    const emit = (event: PointerEvent, force: boolean) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!force && last && Math.hypot(x - last.x, y - last.y) < 8) return;
      last = { x, y };
      const ll = map.containerPointToLatLng([x, y]);
      onDraw?.({ lat: ll.lat, lng: ll.lng });
    };
    const start = (event: PointerEvent) => { down = true; el.setPointerCapture?.(event.pointerId); emit(event, true); event.preventDefault(); };
    const move = (event: PointerEvent) => { if (down) { emit(event, false); event.preventDefault(); } };
    const end = () => { down = false; last = null; };
    map.dragging.disable();
    el.style.touchAction = "none";
    el.style.cursor = "crosshair";
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      map.dragging.enable();
      el.style.touchAction = "";
      el.style.cursor = "";
      el.removeEventListener("pointerdown", start);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
  }, [map, active, onDraw]);
  return null;
}

const strip = (value: string) => value.replace(/[&<>"']/g, "");
const stopIcon = (n: number) => L.divIcon({ className: "hamba-stop-pin", html: `<span>${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
const avatarIcon = (url: string | null | undefined, initial: string) => L.divIcon({
  className: "hamba-avatar-pin",
  html: url ? `<img src="${strip(url)}" alt="" />` : `<span>${strip(initial)}</span>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

export default function TripMap({ points, position, recenter = 0, stops = [], drawn = [], avatarUrl, initial = "Y", onMapClick, drawing = false, onDraw }: Props) {
  const center: [number, number] = points.length ? [points[0].lat, points[0].lng] : [-26.2041, 28.0473];
  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom={false} zoomControl={false} className="hamba-map">
      <TileLayer url={process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"} attribution={process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors"} />
      <FitRoute points={points} recenter={recenter} />
      <Clicks onMapClick={drawing ? undefined : onMapClick} />
      <FreeDraw active={drawing} onDraw={onDraw} />
      {points.length > 1 && <Polyline positions={points.map((point) => [point.lat, point.lng])} pathOptions={{ color: "#54256f", weight: 5 }} />}
      {drawn.length > 1 && <Polyline positions={drawn.map((point) => [point.lat, point.lng])} pathOptions={{ color: "#d94362", weight: 3, dashArray: "6 6" }} />}
      {points[0] && <CircleMarker center={[points[0].lat, points[0].lng]} radius={7} pathOptions={{ color: "#54256f", fillColor: "#54256f", fillOpacity: 1 }} />}
      {points.at(-1) && <CircleMarker center={[points.at(-1)!.lat, points.at(-1)!.lng]} radius={8} pathOptions={{ color: "#d94362", fillColor: "#d94362", fillOpacity: 1 }} />}
      {stops.map((stop, index) => <Marker key={`${stop.lat}-${stop.lng}-${index}`} position={[stop.lat, stop.lng]} icon={stopIcon(index + 1)} />)}
      {position && <Marker position={[position.lat, position.lng]} icon={avatarIcon(avatarUrl, initial)} zIndexOffset={1000} />}
    </MapContainer>
  );
}
