"use client";
import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import type { Alert, AlertLocation } from "@/lib/types";
import type { Position } from "@/lib/geo";
import { hasLocation, haversineKm } from "@/lib/geo";

const TONE: Record<string, string> = { new: "mk-new", acknowledged: "mk-ack", enroute: "mk-enr", on_scene: "mk-sce" };
const HEX: Record<string, string> = {
  new: "var(--st-new)",
  acknowledged: "var(--st-acknowledged)",
  enroute: "var(--st-enroute)",
  on_scene: "var(--st-on-scene)",
};

function Fly({ alert, follow }: { alert: Alert | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (alert && hasLocation(alert)) map.setView([alert.lat!, alert.lng!], 15, { animate: false });
  }, [alert?.id, map]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (follow && alert && hasLocation(alert)) map.panTo([alert.lat!, alert.lng!], { animate: true });
  }, [alert?.lat, alert?.lng, follow, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ResizeMap() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize({ animate: false, pan: false });
    const ro = new ResizeObserver(fix);
    ro.observe(map.getContainer());
    const t1 = setTimeout(fix, 0), t2 = setTimeout(fix, 250);
    window.addEventListener("resize", fix);
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", fix); };
  }, [map]);
  return null;
}

function DeferredTileLayer() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!ready) return null;
  return <TileLayer url={process.env.NEXT_PUBLIC_MAP_TILE_URL!} attribution={process.env.NEXT_PUBLIC_MAP_ATTRIBUTION} subdomains="abcd" keepBuffer={4} maxZoom={19} />;
}

const pin = (status: string, selected: boolean) =>
  L.divIcon({
    className: "",
    html: `<div class="mk ${TONE[status] ?? "mk-enr"} ${selected ? "mk-sel" : ""} ${status === "new" ? "live" : ""}"><span class="mk-ring"></span><span class="mk-dot"></span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const mePin = L.divIcon({
  className: "",
  html: `<div class="mk mk-me"><span class="mk-dot"></span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

type Route = { pts: [number, number][]; km: number | null; min: number | null };

export default function AlertMap({
  alerts, selected, me, trail, onSelect,
}: { alerts: Alert[]; selected: Alert | null; me: Position | null; trail: AlertLocation[]; onSelect?(a: Alert): void }) {
  const [route, setRoute] = useState<Route>({ pts: [], km: null, min: null });
  const [follow, setFollow] = useState(false);

  useEffect(() => {
    if (!me || !selected || !hasLocation(selected)) { setRoute({ pts: [], km: null, min: null }); return; }
    const straight: Route = {
      pts: [[me.lat, me.lng], [selected.lat!, selected.lng!]],
      km: haversineKm(me, { lat: selected.lat!, lng: selected.lng! }),
      min: null,
    };
    const base = process.env.NEXT_PUBLIC_OSRM_URL;
    if (!base) { setRoute(straight); return; }
    const ctrl = new AbortController();
    fetch(`${base}/route/v1/driving/${me.lng},${me.lat};${selected.lng},${selected.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        const r0 = d.routes?.[0];
        if (!r0) return setRoute(straight);
        setRoute({
          pts: r0.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
          km: r0.distance / 1000,
          min: Math.max(1, Math.round(r0.duration / 60)),
        });
      })
      .catch((e) => { if (e.name !== "AbortError") setRoute(straight); });
    return () => ctrl.abort();
  }, [me?.lat, me?.lng, selected?.id, selected?.lat, selected?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const center = useMemo((): [number, number] => (
    selected && hasLocation(selected)
      ? [selected.lat!, selected.lng!]
      : [Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LAT ?? -28.4793), Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LNG ?? 24.6727)]
  ), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = selected && hasLocation(selected) ? selected : null;
  const direct = route.pts.length === 2;
  const fixes = trail.filter((point) => point.lat != null && point.lng != null);

  return (
    <MapContainer center={center} zoom={Number(process.env.NEXT_PUBLIC_DEFAULT_MAP_ZOOM ?? 5)} scrollWheelZoom zoomControl={false} className="alert-map">
      <DeferredTileLayer />
      <ZoomControl position="topleft" />
      <ResizeMap />
      <Fly alert={selected} follow={follow} />

      <div className="absolute z-[1000] top-3 right-3">
        <button className="btn" onClick={() => setFollow((value) => !value)} aria-pressed={follow}>
          Follow incident
        </button>
      </div>

      {/* range rings around the selected incident */}
      {sel && (
        <>
          <Circle center={[sel.lat!, sel.lng!]} radius={250} pathOptions={{ color: HEX[sel.status] ?? "var(--st-enroute)", weight: 1, dashArray: "4 6", fillOpacity: 0.06 }} />
          <Circle center={[sel.lat!, sel.lng!]} radius={1000} pathOptions={{ color: HEX[sel.status] ?? "var(--st-enroute)", weight: 1, dashArray: "2 8", fillOpacity: 0 }} />
        </>
      )}

      {alerts.filter(hasLocation).map((a) => {
        const isSel = selected?.id === a.id;
        return (
          <Marker
            key={`${a.id}-${a.status}-${isSel}`}
            position={[a.lat!, a.lng!]}
            icon={pin(a.status, isSel)}
            zIndexOffset={isSel ? 1000 : a.status === "new" ? 500 : 0}
            eventHandlers={{ click: () => onSelect?.(a) }}
          >
            {isSel && <Tooltip permanent direction="top" offset={[0, -14]} className="mk-tip">{a.device?.device_name ?? a.device_id}</Tooltip>}
          </Marker>
        );
      })}

      {me && (
        <>
          <Marker position={[me.lat, me.lng]} icon={mePin}><Popup>Your location</Popup></Marker>
          <Circle center={[me.lat, me.lng]} radius={me.accuracy ?? 20} pathOptions={{ color: "var(--st-resolved)", weight: 1, fillOpacity: 0.08 }} />
        </>
      )}

      {route.pts.length > 1 && (
        <>
          {!direct && <Polyline positions={route.pts} pathOptions={{ color: "var(--chrome)", weight: 9, opacity: 0.9 }} />}
          <Polyline positions={route.pts} pathOptions={{ color: "var(--text)", weight: 4, dashArray: direct ? "8 8" : undefined }} />
        </>
      )}

      {fixes.length > 1 && fixes.slice(1).map((point, index) => {
        const previous = fixes[index];
        const degraded = point.loc_source !== "gps";
        return <Polyline key={`${point.id}-${point.ctr}`} positions={[[previous.lat!, previous.lng!], [point.lat!, point.lng!]]} pathOptions={{ color: degraded ? "var(--muted)" : "var(--st-enroute)", weight: 3, opacity: degraded ? 0.6 : 0.9, dashArray: degraded ? "4 7" : undefined }} />;
      })}
      {fixes.map((point) => (
        <CircleMarker key={`fix-${point.id}-${point.ctr}`} center={[point.lat!, point.lng!]} radius={3} pathOptions={{ color: point.loc_source === "gps" ? "var(--st-enroute)" : "var(--muted)", weight: 1, fillOpacity: 0.9 }} />
      ))}

      {/* bottom HUD: legend + route */}
      <div className="absolute z-[1000] bottom-3 left-3 right-3 flex justify-center pointer-events-none">
          <div className="panel pointer-events-auto flex items-center gap-4 px-3 h-9 text-[13px] !overflow-x-auto !overflow-y-hidden max-w-full">
            {[["New", "var(--st-new)"], ["Acknowledged", "var(--st-acknowledged)"], ["En route", "var(--st-enroute)"], ["On scene", "var(--st-on-scene)"], ["You", "var(--st-resolved)"]].map(([n, c]) => (
            <span key={n} className="flex items-center gap-1.5 whitespace-nowrap muted">
              <i className="w-2 h-2" style={{ background: c }} />{n}
            </span>
          ))}
          {route.km != null && (
            <>
              <span className="w-px h-4 bg-[var(--line-strong)]" />
              <span className="data whitespace-nowrap">
                <span className="label mr-2">{direct ? "Direct" : "Route"}</span>
                {route.km.toFixed(1)} km{route.min != null && <> · <b className="text-[var(--accent)]">{route.min} min</b></>}
              </span>
            </>
          )}
        </div>
      </div>
    </MapContainer>
  );
}