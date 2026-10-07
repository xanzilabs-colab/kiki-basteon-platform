"use client";

import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { Alert, AlertLocation } from "@/lib/types";
import type { Position } from "@/lib/geo";
import { hasLocation } from "@/lib/geo";

function Fly({ alert }: { alert: Alert | null }) {
  const map = useMap();

  useEffect(() => {
    if (alert && hasLocation(alert)) {
      map.flyTo([alert.lat!, alert.lng!], 15);
    }
  }, [alert, map]);

  return null;
}

function ResizeMap() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const resize = () => map.invalidateSize({ animate: false, pan: false });
    const observer = new ResizeObserver(resize);

    observer.observe(container);
    const frame = requestAnimationFrame(resize);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

const icon = (color: string, selected: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="width:${selected ? 24 : 16}px;height:${selected ? 24 : 16}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 5px ${color}55"></div>`,
    iconSize: [selected ? 24 : 16, selected ? 24 : 16],
    iconAnchor: [selected ? 12 : 8, selected ? 12 : 8],
  });

export default function AlertMap({
  alerts,
  selected,
  me,
  trail = [],
  onSelect,
}: {
  alerts: Alert[];
  selected: Alert | null;
  me: Position | null;
  trail?: AlertLocation[];
  onSelect?: (alert: Alert) => void;
}) {
  const [route, setRoute] = useState<[number, number][]>([]);

  useEffect(() => {
    if (!me || !selected || !hasLocation(selected)) {
      setRoute([]);
      return;
    }

    const url = `${process.env.NEXT_PUBLIC_OSRM_URL}/route/v1/driving/${me.lng},${me.lat};${selected.lng},${selected.lat}?overview=full&geometries=geojson`;

    fetch(url)
      .then((response) => response.json())
      .then(
        (data) =>
          setRoute(
            data.routes?.[0]?.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]) ?? [],
          ),
      )
      .catch(() => setRoute([[me.lat, me.lng], [selected.lat!, selected.lng!]]));
  }, [me, selected]);

  const trailPoints = useMemo(
    () =>
      trail
        .filter((point) => point.lat != null && point.lng != null)
        .map((point) => [point.lat, point.lng] as [number, number]),
    [trail],
  );

  const center = useMemo(
    (): [number, number] =>
      selected && hasLocation(selected)
        ? [selected.lat!, selected.lng!]
        : [
            Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LAT ?? -28.4793),
            Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LNG ?? 24.6727),
          ],
    [selected],
  );

  return (
    <MapContainer
      center={center}
      zoom={Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_ZOOM ?? 5)}
      scrollWheelZoom
      className="alert-map"
    >
      <TileLayer
        url={process.env.NEXT_PUBLIC_MAP_TILE_URL!}
        attribution={process.env.NEXT_PUBLIC_MAP_ATTRIBUTION}
      />
      <ResizeMap />
      <Fly alert={selected} />

      {alerts.filter(hasLocation).map((alert) => (
        <Marker
          key={alert.id}
          position={[alert.lat!, alert.lng!]}
          icon={icon(alert.status === "new" ? "#ff4d5a" : "#28d5c0", selected?.id === alert.id)}
          eventHandlers={{
            click: () => onSelect?.(alert),
          }}
        >
          <Popup>{alert.device?.device_name ?? alert.device_id}</Popup>
        </Marker>
      ))}

      {me && (
        <>
          <Marker position={[me.lat, me.lng]} icon={icon("#3b9cff", false)}>
            <Popup>Your location</Popup>
          </Marker>
          <Circle center={[me.lat, me.lng]} radius={me.accuracy ?? 20} pathOptions={{ color: "#3b9cff" }} />
        </>
      )}

      {trailPoints.length > 1 && (
        <Polyline positions={trailPoints} pathOptions={{ color: "#6ee7b7", weight: 3, opacity: 0.9 }} />
      )}

      {route.length > 1 && (
        <Polyline
          positions={route}
          pathOptions={{ color: "#28d5c0", weight: 4, dashArray: route.length === 2 ? "8 8" : undefined }}
        />
      )}
    </MapContainer>
  );
}
