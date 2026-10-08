"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Alert, AlertLocation } from "@/lib/types";
import type { Position } from "@/lib/geo";
import { hasLocation } from "@/lib/geo";
import { deadReckon, headingToCompass, isMovingAlert } from "@/lib/motion";
import { locationHealth } from "@/lib/locationTracking";

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
  const animatedMarkerRef = useRef<L.Marker | null>(null);
  const predictedMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const animFromRef = useRef<{ lat: number; lng: number } | null>(null);
  const animToRef = useRef<{ lat: number; lng: number } | null>(null);
  const animStartRef = useRef<number>(0);
  const animDurationRef = useRef<number>(1000);
  const latestPointAtRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const followRef = useRef(true);
  const [followMode, setFollowMode] = useState(true);

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
    const onUserMove = () => {
      followRef.current = false;
      setFollowMode(false);
    };
    map.on("dragstart", onUserMove);
    map.on("zoomstart", onUserMove);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      map.off("dragstart", onUserMove);
      map.off("zoomstart", onUserMove);
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
        L.polyline(trailPoints, { color: "#6ee7b7", weight: 3, opacity: 0.75 }),
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
    if (!map || !selected || !hasLocation(selected)) return;

    const now = performance.now();
    const prev = animToRef.current ?? { lat: selected.lat!, lng: selected.lng! };
    const next = { lat: selected.lat!, lng: selected.lng! };
    const latestTrailPoint = [...trail].reverse().find((point) => point.lat != null && point.lng != null);
    const recordedAt = latestTrailPoint ? new Date(latestTrailPoint.recorded_at).getTime() : Date.now();
    const previousRecordedAt = latestPointAtRef.current || recordedAt;
    latestPointAtRef.current = recordedAt;
    const between = Math.max(1_000, Math.min(10_000, recordedAt - previousRecordedAt || 1_500));
    animFromRef.current = prev;
    animToRef.current = next;
    animStartRef.current = now;
    animDurationRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : between;

    if (!animatedMarkerRef.current) {
      animatedMarkerRef.current = L.marker([selected.lat!, selected.lng!], { icon: icon(selected.is_simulated_loc ? "#9CA3AF" : "#ff4d5a", true) }).addTo(map);
    }
    animatedMarkerRef.current.setIcon(icon(selected.is_simulated_loc ? "#9CA3AF" : "#ff4d5a", true));

    if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = L.circle([selected.lat!, selected.lng!], { radius: 20, color: "#6ee7b7", opacity: 0.25, fillOpacity: 0.06 }).addTo(map);
    }
    const haloMeters = Math.max(5, Math.min(100, Math.round((selected.last_hdop ?? 4) * 5)));
    accuracyCircleRef.current.setRadius(haloMeters);

    const animate = () => {
      if (!animatedMarkerRef.current || !animFromRef.current || !animToRef.current) return;
      const progress = Math.min(1, (performance.now() - animStartRef.current) / animDurationRef.current);
      const lat = animFromRef.current.lat + (animToRef.current.lat - animFromRef.current.lat) * progress;
      const lng = animFromRef.current.lng + (animToRef.current.lng - animFromRef.current.lng) * progress;
      animatedMarkerRef.current.setLatLng([lat, lng]);
      accuracyCircleRef.current?.setLatLng([lat, lng]);

      const stale = locationHealth(selected) === "stale";
      if (!stale && isMovingAlert(selected) && selected.speed_kmh != null && selected.heading_deg != null) {
        const predicted = deadReckon(lat, lng, selected.speed_kmh, selected.heading_deg, 30_000);
        if (!predictedMarkerRef.current) {
          predictedMarkerRef.current = L.marker([predicted.lat, predicted.lng], {
            icon: L.divIcon({ className: "", html: `<div style="padding:2px 6px;border:1px dashed #7dd3fc;color:#7dd3fc;background:rgba(15,23,42,.7);font-size:10px;border-radius:999px;">+30s ${headingToCompass(selected.heading_deg)}</div>` }),
          }).addTo(map);
        } else {
          predictedMarkerRef.current.setLatLng([predicted.lat, predicted.lng]);
        }
      } else if (predictedMarkerRef.current) {
        map.removeLayer(predictedMarkerRef.current);
        predictedMarkerRef.current = null;
      }

      if (followRef.current && followMode) map.panTo([lat, lng], { animate: true, duration: 0.6 });
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [followMode, selected, trail]);

  useEffect(() => () => {
    const map = mapRef.current;
    if (!map) return;
    if (animatedMarkerRef.current) map.removeLayer(animatedMarkerRef.current);
    if (predictedMarkerRef.current) map.removeLayer(predictedMarkerRef.current);
    if (accuracyCircleRef.current) map.removeLayer(accuracyCircleRef.current);
  }, []);

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

  return <div className="relative h-full"><div ref={containerRef} className="alert-map leaflet-container" />{!followMode && <button className="btn absolute right-3 top-3 z-[1200]" onClick={() => { followRef.current = true; setFollowMode(true); if (selected && hasLocation(selected)) mapRef.current?.panTo([selected.lat!, selected.lng!], { animate: true }); }}>Re-center</button>}</div>;
}
