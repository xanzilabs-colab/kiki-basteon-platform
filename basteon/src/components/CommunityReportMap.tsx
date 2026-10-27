"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, X } from "lucide-react";
import L from "leaflet";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayers";

export type ReportRegion = {
  type: "Polygon";
  coordinates: [number, number][][];
};

export type ReportLocation = {
  point: { lat: number; lng: number } | null;
  region: ReportRegion | null;
};

type Props = {
  initialPoint: { lat: number; lng: number } | null;
  value: ReportLocation;
  onChange: (value: ReportLocation) => void;
};

type Mode = "view" | "pin" | "region";
type EditMode = "pin" | "region" | null;

function getRegionCenter(ring: [number, number][]) {
  const vertices = ring.slice(0, -1);
  return {
    lat: vertices.reduce((sum, [, lat]) => sum + lat, 0) / vertices.length,
    lng: vertices.reduce((sum, [lng]) => sum + lng, 0) / vertices.length,
  };
}

function closeRing(points: [number, number][]): [number, number][] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export default function CommunityReportMap({ initialPoint, value, onChange }: Props) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selectionLayerRef = useRef<L.LayerGroup | null>(null);
  const modeRef = useRef<Mode>("view");
  const onChangeRef = useRef(onChange);
  const [mode, setMode] = useState<Mode>("view");
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [baseLayer, setBaseLayer] = useState<MapBaseLayerName>("Street");
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [expanded, setExpanded] = useState(false);

  modeRef.current = mode;
  onChangeRef.current = onChange;

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;

    const map = L.map(element, { scrollWheelZoom: true }).setView(
      initialPoint ? [initialPoint.lat, initialPoint.lng] : [-29, 24],
      initialPoint ? 14 : 5,
    );
    mapRef.current = map;
    const baseLayers = MAP_BASE_LAYERS.map((layer) => ({
      name: layer.name,
      layer: L.tileLayer(layer.url, { attribution: layer.attribution, maxZoom: layer.maxZoom }),
    }));
    const street = baseLayers[0];
    if (!street) throw new Error("At least one map layer must be configured.");
    street.layer.addTo(map);
    selectionLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", ({ latlng }) => {
      const nextMode = modeRef.current;
      if (nextMode === "pin") {
        onChangeRef.current({ point: { lat: latlng.lat, lng: latlng.lng }, region: null });
        setEditMode(null);
        setMode("view");
      } else if (nextMode === "region") {
        setDraftPoints((points) => [...points, [latlng.lng, latlng.lat]]);
      }
    });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false }));
    resizeObserver.observe(element);
    const resizeFrame = requestAnimationFrame(() => map.invalidateSize({ animate: false, pan: false }));

    return () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      selectionLayerRef.current?.clearLayers();
      selectionLayerRef.current = null;
      baseLayers.forEach(({ layer }) => layer.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = MAP_BASE_LAYERS.find(({ name }) => name === baseLayer);
    if (!selected) return;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });
    L.tileLayer(selected.url, { attribution: selected.attribution, maxZoom: selected.maxZoom }).addTo(map);
  }, [baseLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const selectionLayer = selectionLayerRef.current;
    if (!map || !selectionLayer) return;
    selectionLayer.clearLayers();
    if (mode === "view" && editMode === null && value.point) {
      map.panTo([value.point.lat, value.point.lng], { animate: true, duration: 0.35 });
    }

    const location = value.point;
    if (location && !value.region) {
      const marker = L.marker([location.lat, location.lng], {
        draggable: editMode === "pin",
        icon: L.divIcon({
          className: "community-report-map-pin",
          html: '<span aria-hidden="true"></span>',
          iconSize: [38, 46],
          iconAnchor: [19, 43],
        }),
        zIndexOffset: editMode === "pin" ? 1000 : 0,
      }).addTo(selectionLayer);
      if (editMode === "pin") marker.getElement()?.classList.add("is-editing");
      marker.on("click", (event) => L.DomEvent.stopPropagation(event));
      marker.on("dragend", () => {
        const next = marker.getLatLng();
        onChangeRef.current({ point: { lat: next.lat, lng: next.lng }, region: null });
      });

      let holdTimer: number | null = null;
      const startHold = () => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          setEditMode("pin");
        }, 550);
      };
      const endHold = () => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;
      };
      marker.on("mousedown touchstart", startHold);
      marker.on("mouseup touchend touchcancel mouseout", endHold);
    }

    if (value.region) {
      const ring = value.region.coordinates[0];
      if (ring?.length) {
        const polygon = L.polygon(ring.map(([lng, lat]) => [lat, lng]), {
          color: editMode === "region" ? "#7c3aed" : "#54266f",
          weight: editMode === "region" ? 5 : 3,
          fillColor: "#a855f7",
          fillOpacity: editMode === "region" ? 0.28 : 0.2,
        }).addTo(selectionLayer);
        polygon.on("click", (event) => L.DomEvent.stopPropagation(event));
        let holdTimer: number | null = null;
        const startHold = () => {
          if (holdTimer !== null) window.clearTimeout(holdTimer);
          holdTimer = window.setTimeout(() => {
            holdTimer = null;
            setEditMode("region");
          }, 550);
        };
        const endHold = () => {
          if (holdTimer !== null) window.clearTimeout(holdTimer);
          holdTimer = null;
        };
        polygon.on("mousedown touchstart", startHold);
        polygon.on("mouseup touchend touchcancel mouseout", endHold);

        if (editMode === "region") {
          ring.slice(0, -1).forEach((coordinate, index) => {
            const handle = L.marker([coordinate[1], coordinate[0]], {
              draggable: true,
              icon: L.divIcon({
                className: "community-report-region-handle",
                html: '<span aria-hidden="true"></span>',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
              }),
            }).addTo(selectionLayer);
            handle.on("dragend", () => {
              const nextRing = ring.map(([lng, lat]) => [lng, lat] as [number, number]);
              const next = handle.getLatLng();
              nextRing[index] = [next.lng, next.lat];
              nextRing[nextRing.length - 1] = [...nextRing[0]!] as [number, number];
              const region: ReportRegion = { type: "Polygon", coordinates: [nextRing] };
              onChangeRef.current({ point: getRegionCenter(nextRing), region });
            });
          });
        }
      }
    }

    if (mode === "region" && draftPoints.length) {
      const preview = draftPoints.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(preview, { color: "#54266f", weight: 3, dashArray: "7 7" }).addTo(selectionLayer);
      draftPoints.forEach(([lng, lat]) => L.circleMarker([lat, lng], {
        radius: 5,
        color: "#fff",
        weight: 2,
        fillColor: "#7c3aed",
        fillOpacity: 1,
      }).addTo(selectionLayer));
    }
  }, [draftPoints, editMode, mode, value]);

  useEffect(() => {
    if (!expanded) return;
    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    const frame = requestAnimationFrame(() => mapRef.current?.invalidateSize({ animate: false, pan: false }));
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      cancelAnimationFrame(frame);
    };
  }, [expanded]);

  function startPinPlacement() {
    setEditMode(null);
    setDraftPoints([]);
    onChange({ point: null, region: null });
    setMode("pin");
  }

  function startRegionDrawing() {
    setEditMode(null);
    onChange({ point: null, region: null });
    setDraftPoints([]);
    setMode("region");
  }

  function finishRegion() {
    if (draftPoints.length < 3) return;
    const ring = closeRing(draftPoints);
    const region: ReportRegion = { type: "Polygon", coordinates: [ring] };
    onChange({ point: getRegionCenter(ring), region });
    setDraftPoints([]);
    setMode("view");
    setEditMode(null);
  }

  function deleteSelection() {
    onChange({ point: null, region: null });
    setEditMode(null);
    setMode("view");
    setDraftPoints([]);
  }

  return (
    <div className={`community-report-map${expanded ? " is-expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} aria-label={expanded ? "Expanded report location map" : undefined}>
      <div className="community-report-map-toolbar">
        <label>
          <span className="sr-only">Map style</span>
          <select aria-label="Map style" value={baseLayer} onChange={(event) => {
            const next = MAP_BASE_LAYERS.find(({ name }) => name === event.target.value)?.name;
            if (next) setBaseLayer(next);
          }}>
            {MAP_BASE_LAYERS.map(({ name }) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <button type="button" aria-pressed={mode === "pin"} onClick={startPinPlacement}>Place a pin</button>
        <button type="button" aria-pressed={mode === "region"} onClick={startRegionDrawing}>Draw an area</button>
        {mode === "region" && <button type="button" disabled={draftPoints.length < 3} onClick={finishRegion}>Finish area</button>}
        {editMode && <span className="community-report-map-editing" role="status">Editing {editMode === "pin" ? "pin" : "area"}</span>}
        {editMode && <button type="button" onClick={() => setEditMode(null)}>Done editing</button>}
        {(value.point || draftPoints.length > 0) && <button type="button" className="community-report-map-delete" onClick={deleteSelection}>Delete selection</button>}
        <button type="button" className="community-report-map-expand" aria-label={expanded ? "Close expanded map" : "Expand map"} onClick={() => setExpanded((current) => !current)}>{expanded ? <X size={15} /> : <Expand size={15} />}{expanded ? "Close map" : "Expand map"}</button>
      </div>
      <div ref={mapElementRef} className="community-report-map-canvas" role="application" aria-label="Choose a report location on the map" />
      <p className="community-report-map-help">
        {mode === "pin"
          ? "Tap the map to place a pin. Hold a placed pin to enter edit mode, then drag it."
          : mode === "region"
            ? `Tap at least 3 points to draw an area (${draftPoints.length} placed). Hold the area to edit its vertices.`
            : value.region
              ? "Your marked area stays fixed while the map moves. Hold the area to edit its vertices."
              : value.point
                ? "Your pin stays fixed while the map moves. Hold it to edit or delete it."
                : "Move or zoom the map, then choose Place a pin or Draw an area."}
      </p>
    </div>
  );
}
