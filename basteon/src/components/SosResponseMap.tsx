"use client";

import { Fragment, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

export type MapPoint = { lat: number; lng: number };
export type ResponseRoute = {
  points: MapPoint[];
  distanceM: number;
  durationS: number | null;
  roadRoute: boolean;
};
export type MapResponder = {
  id: string;
  name: string;
  status: string;
  organisation?: string | null;
  role?: string | null;
  location: MapPoint | null;
  route?: ResponseRoute;
};

function FitResponse({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const signature = points.map(({ lat, lng }) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map(({ lat, lng }) => [lat, lng]), { padding: [36, 36], maxZoom: 15 });
    } else if (points[0]) {
      map.setView([points[0].lat, points[0].lng], 15);
    }
  }, [map, signature]);
  return null;
}

export default function SosResponseMap({
  caller,
  responders,
}: {
  caller: MapPoint | null;
  responders: MapResponder[];
}) {
  const mapPoints = useMemo(
    () => [caller, ...responders.map((responder) => responder.location)]
      .filter((point): point is MapPoint => point !== null),
    [caller, responders],
  );
  const center: [number, number] = caller ? [caller.lat, caller.lng] : [-26.2041, 28.0473];

  return (
    <MapContainer center={center} zoom={caller ? 14 : 5} scrollWheelZoom className="h-full min-h-[300px] w-full">
      <TileLayer
        url={process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
        attribution={process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "© OpenStreetMap contributors"}
      />
      <FitResponse points={mapPoints} />
      {caller && (
        <CircleMarker center={[caller.lat, caller.lng]} radius={12} pathOptions={{ color: "#fff", weight: 3, fillColor: "#ef4444", fillOpacity: 1 }}>
          <Popup>Your location · emergency alert</Popup>
        </CircleMarker>
      )}
      {responders.map((responder, index) => (
        <Fragment key={responder.id}>
          {responder.route && responder.route.points.length > 1 && (
            <Polyline
              positions={responder.route.points.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: ["#0f766e", "#2563eb", "#7c3aed", "#d97706"][index % 4], weight: 4, opacity: 0.8, dashArray: responder.route.roadRoute ? undefined : "7 7" }}
            />
          )}
          {responder.location && (
            <CircleMarker center={[responder.location.lat, responder.location.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0f766e", fillOpacity: 1 }}>
              <Popup>{responder.name} · {responder.status.replaceAll("_", " ")}</Popup>
            </CircleMarker>
          )}
        </Fragment>
      ))}
    </MapContainer>
  );
}
