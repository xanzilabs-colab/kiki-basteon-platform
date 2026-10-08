"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Alert, AlertLocation } from "@/lib/types";
import type { Position } from "@/lib/geo";
import { hasLocation } from "@/lib/geo";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const initialView = useRef({
    center:
      selected && hasLocation(selected)
        ? ([selected.lat!, selected.lng!] as [number, number])
        : [
            Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LAT ?? -28.4793),
            Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LNG ?? 24.6727),
          ] as [number, number],
    zoom: Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_ZOOM ?? 5),
  });
  const [route, setRoute] = useState<[number, number][]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, { scrollWheelZoom: true }).setView(
      initialView.current.center,
      initialView.current.zoom,
    );
    mapRef.current = map;

    L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILE_URL!, {
      attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
    }).addTo(map);

    const resize = () => map.invalidateSize({ animate: false, pan: false });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const frame = requestAnimationFrame(resize);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers = L.layerGroup().addTo(map);

    for (const alert of alerts.filter(hasLocation)) {
      const marker = L.marker([alert.lat!, alert.lng!], {
        icon: icon(alert.status === "new" ? "#ff4d5a" : "#28d5c0", selected?.id === alert.id),
      }).bindPopup(alert.device?.device_name ?? alert.device_id);
      marker.on("click", () => onSelect?.(alert));
      layers.addLayer(marker);
    }

    if (me) {
      layers.addLayer(
        L.marker([me.lat, me.lng], { icon: icon("#3b9cff", false) }).bindPopup("Your location"),
      );
      layers.addLayer(
        L.circle([me.lat, me.lng], {
          radius: me.accuracy ?? 20,
          color: "#3b9cff",
        }),
      );
    }

    const trailPoints = trail
      .filter((point) => point.lat != null && point.lng != null)
      .map((point) => [point.lat, point.lng] as [number, number]);
    if (trailPoints.length > 1) {
      layers.addLayer(
        L.polyline(trailPoints, { color: "#6ee7b7", weight: 3, opacity: 0.9 }),
      );
    }

    if (route.length > 1) {
      layers.addLayer(
        L.polyline(route, {
          color: "#28d5c0",
          weight: 4,
          dashArray: route.length === 2 ? "8 8" : undefined,
        }),
      );
    }

    return () => {
      layers.remove();
    };
  }, [alerts, me, onSelect, route, selected?.id, trail]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && selected && hasLocation(selected)) {
      map.flyTo([selected.lat!, selected.lng!], 15);
    }
  }, [selected]);

  useEffect(() => {
    if (!me || !selected || !hasLocation(selected)) {
      setRoute([]);
      return;
    }

    const controller = new AbortController();
    const url = `${process.env.NEXT_PUBLIC_OSRM_URL}/route/v1/driving/${me.lng},${me.lat};${selected.lng},${selected.lat}?overview=full&geometries=geojson`;

    fetch(url, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) =>
        setRoute(
          data.routes?.[0]?.geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng],
          ) ?? [],
        ),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRoute([[me.lat, me.lng], [selected.lat!, selected.lng!]]);
      });

    return () => controller.abort();
  }, [me, selected]);

  return <div ref={containerRef} className="alert-map leaflet-container" />;
}
