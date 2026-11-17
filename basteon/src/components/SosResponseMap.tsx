"use client";

import { Fragment, useEffect, useMemo } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, useMap } from "react-leaflet";
import { installMapBaseLayers, type MapBaseLayerName } from "@/lib/mapLayers";

export type MapPoint = { lat: number; lng: number; accuracyM?: number | null };
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
  location: (MapPoint & { seenAt: string }) | null;
  route?: ResponseRoute;
};

function FitResponse({ points, recenter }: { points: MapPoint[]; recenter: number }) {
  const map = useMap();
  const signature = points.map(({ lat, lng }) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join("|");
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map(({ lat, lng }) => [lat, lng]), { padding: [36, 36], maxZoom: 15 });
    } else if (points[0]) {
      map.setView([points[0].lat, points[0].lng], 15);
    }
  }, [map, signature, recenter]);
  return null;
}

function ResponseBaseLayer({ layer }: { layer: MapBaseLayerName }) {
  const map = useMap();
  useEffect(() => {
    const layers = installMapBaseLayers(map);
    layers.select(layer);
    return () => layers.remove();
  }, [layer, map]);
  return null;
}

export default function SosResponseMap({
  caller,
  responders,
  layer,
  recenter,
}: {
  caller: MapPoint | null;
  responders: MapResponder[];
  layer: MapBaseLayerName;
  recenter: number;
}) {
  const mapPoints = useMemo(
    () => [caller, ...responders.map((responder) => responder.location)]
      .filter((point): point is MapPoint => point !== null),
    [caller, responders],
  );
  const center: [number, number] = caller ? [caller.lat, caller.lng] : [-26.2041, 28.0473];

  return (
    <MapContainer center={center} zoom={caller ? 14 : 5} scrollWheelZoom attributionControl={false} zoomControl={false} className="h-full min-h-[300px] w-full">
      <ResponseBaseLayer layer={layer} />
      <FitResponse points={mapPoints} recenter={recenter} />
      {caller && (
        <>
          {caller.accuracyM != null && caller.accuracyM > 0 && (
            <Circle center={[caller.lat, caller.lng]} radius={caller.accuracyM} pathOptions={{ color: "#ef4444", weight: 1, fillColor: "#ef4444", fillOpacity: 0.12 }} />
          )}
          <CircleMarker center={[caller.lat, caller.lng]} radius={12} pathOptions={{ color: "#fff", weight: 3, fillColor: "#ef4444", fillOpacity: 1 }}>
            <Popup>Your location{caller.accuracyM != null ? ` · reported accuracy ±${Math.round(caller.accuracyM)} m` : ""}</Popup>
          </CircleMarker>
        </>
      )}
      {responders.map((responder, index) => (
        <Fragment key={responder.id}>
          {responder.route?.roadRoute && responder.route.points.length > 1 && (
            <Polyline
              positions={responder.route.points.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: ["#0f766e", "#2563eb", "#7c3aed", "#d97706"][index % 4], weight: 4, opacity: 0.8 }}
            />
          )}
          {responder.location && (
            <>
              {responder.location.accuracyM != null && responder.location.accuracyM > 0 && (
                <Circle center={[responder.location.lat, responder.location.lng]} radius={responder.location.accuracyM} pathOptions={{ color: "#0f766e", weight: 1, fillColor: "#0f766e", fillOpacity: 0.12 }} />
              )}
              <CircleMarker center={[responder.location.lat, responder.location.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0f766e", fillOpacity: 1 }}>
                <Popup>{responder.name} · {responder.status.replaceAll("_", " ")}{responder.location.accuracyM != null ? ` · reported accuracy ±${Math.round(responder.location.accuracyM)} m` : ""}</Popup>
              </CircleMarker>
            </>
          )}
        </Fragment>
      ))}
    </MapContainer>
  );
}
