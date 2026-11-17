"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Check, Clock3, HeartPulse, RefreshCw, ShieldCheck, Siren } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SosType } from "@/lib/sos/sosGesture";
import { estimateResponseRoute, formatResponseEta } from "@/lib/sos/responseRoute";
import type { MapPoint, MapResponder, ResponseRoute } from "./SosResponseMap";
import { useAppDialog } from "@/components/AppDialogProvider";
import { MapBottomSheet, MapScreen } from "@/components/account/MapScreen";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayerOptions";
import type { Position } from "@/lib/geo";
import { watchLocation } from "@/lib/platform/location";

const ResponseMap = dynamic(() => import("./SosResponseMap"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[300px] place-items-center bg-slate-100 text-sm text-slate-500">Preparing your live map…</div>,
});

type ResponseData = {
  alert: { id: string; status: string; typeCode: string | null; lat: number | null; lng: number | null; accuracyM: number | null; locAt: string | null; lastLocationAt: string | null; triggeredAt: string; updatedAt: string };
  responders: Array<{ id: string; name: string; status: string; organisation?: string | null; role?: string | null; acceptedAt: string; location: (MapPoint & { seenAt: string }) | null }>;
};
type RouteCacheEntry = { route: ResponseRoute; origin: MapPoint; responder: MapPoint; checkedAt: number };

const statusCopy: Record<string, string> = {
  acknowledged: "Acknowledged · travel not confirmed yet",
  en_route: "En route to you",
  on_scene: "Arrived at your location",
  withdrawn: "No longer responding",
  unavailable: "No longer responding",
};

function distanceMeters(from: MapPoint, to: MapPoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number) {
  return meters < 1_000 ? `${Math.round(meters)} m` : `${(meters / 1_000).toFixed(1)} km`;
}

function directEstimate(origin: MapPoint, destination: MapPoint): ResponseRoute {
  return estimateResponseRoute(origin, destination);
}

async function callerLocationUpdate(alertId: string, position: Position): Promise<string | null> {
  const speedKmh = Number.isFinite(position.speed ?? NaN) ? position.speed! * 3.6 : null;
  const motion = speedKmh == null
    ? { motion_state: "unknown", is_moving: false }
    : speedKmh >= 15
      ? { motion_state: "vehicle", is_moving: true }
      : speedKmh >= 2
        ? { motion_state: "walking", is_moving: true }
        : { motion_state: "still", is_moving: false };
  try {
    const response = await fetch("/api/account/sos/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alert_id: alertId,
        lat: position.lat,
        lng: position.lng,
        accuracy_m: Number.isFinite(position.accuracy) ? position.accuracy : undefined,
        speed_kmh: speedKmh == null ? undefined : Number(speedKmh.toFixed(1)),
        heading_deg: Number.isFinite(position.heading ?? NaN) ? Math.round((position.heading! + 360) % 360) : undefined,
        motion_state: motion.motion_state,
        is_moving: motion.is_moving,
        fix_age_s: typeof position.capturedAt === "number" ? Math.max(0, Math.floor((Date.now() - position.capturedAt) / 1000)) : 0,
      }),
    });
    if (response.ok) return null;
    const result = await response.json().catch(() => ({}));
    return result.error === "closed_alert" ? null : "Live location is delayed; updates will retry.";
  } catch {
    return "Live location is delayed; updates will retry.";
  }
}

export function SosResponseScreen({
  alertId,
  type,
  changingType,
  typeChangeError,
  onClose,
  onChangeType,
}: {
  alertId: string;
  type: SosType;
  changingType: boolean;
  typeChangeError: string;
  onClose(): void;
  onChangeType(): void;
}) {
  const { confirm } = useAppDialog();
  const [data, setData] = useState<ResponseData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [trackingError, setTrackingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [sheetLevel, setSheetLevel] = useState<0 | 1 | 2>(0);
  const [mapLayer, setMapLayer] = useState<MapBaseLayerName>(MAP_BASE_LAYERS[0].name);
  const [mapRecenter, setMapRecenter] = useState(0);
  const routeCache = useRef(new Map<string, RouteCacheEntry>());
  const routeRequests = useRef(new Set<string>());
  const [routes, setRoutes] = useState<Record<string, ResponseRoute>>({});
  const closed = data?.alert.status === "resolved" || data?.alert.status === "false_alarm";
  const falseAlarm = data?.alert.status === "false_alarm";

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/account/sos/responses?alert_id=${encodeURIComponent(alertId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError("Live responder updates are temporarily unavailable. We’ll keep trying.");
        return;
      }
      setData(body as ResponseData);
      setLoadError("");
    } catch {
      setLoadError("Live responder updates are temporarily unavailable. We’ll keep trying.");
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [alertId, refresh]);

  useEffect(() => {
    if (closed) return;
    let active = true;
    let inFlight = false;
    let lastSentAt = 0;
    const publishLocation = (position: Position) => {
      if (!active || inFlight || Date.now() - lastSentAt < 4_000) return;
      inFlight = true;
      lastSentAt = Date.now();
      void callerLocationUpdate(alertId, position)
        .then((message) => { if (active) setTrackingError(message ?? ""); })
        .finally(() => { inFlight = false; });
    };
    const stopWatching = watchLocation(
      publishLocation,
      () => { if (active) setTrackingError("Could not read your location. Check device location permission."); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    return () => {
      active = false;
      stopWatching();
    };
  }, [alertId, closed]);

  const caller = useMemo<MapPoint | null>(() => {
    if (data?.alert.lat == null || data.alert.lng == null) return null;
    return { lat: data.alert.lat, lng: data.alert.lng, accuracyM: data.alert.accuracyM };
  }, [data?.alert.accuracyM, data?.alert.lat, data?.alert.lng]);

  useEffect(() => {
    if (!caller || !data?.responders.length) return;
    let active = true;
    const updateRoutes = async () => {
      const next: Record<string, ResponseRoute> = {};
      await Promise.all(data.responders.map(async (responder) => {
        if (!responder.location) return;
        const destination = { lat: responder.location.lat, lng: responder.location.lng };
        const cached = routeCache.current.get(responder.id);
        const movedEnough = !cached
          || distanceMeters(cached.origin, caller) > 100
          || distanceMeters(cached.responder, destination) > 100;
        if (cached && !movedEnough && Date.now() - cached.checkedAt < 45_000) {
          next[responder.id] = cached.route;
          return;
        }
        if (routeRequests.current.has(responder.id)) {
          if (cached) next[responder.id] = cached.route;
          return;
        }
        routeRequests.current.add(responder.id);
        let route = directEstimate(destination, caller);
        try {
          const query = new URLSearchParams({ alert_id: alertId, assignment_id: responder.id });
          const response = await fetch(`/api/account/sos/route-plan?${query}`, { cache: "no-store" });
          if (response.ok) {
            const planned = await response.json() as { points: MapPoint[]; distanceM: number; durationS: number };
            route = { ...planned, roadRoute: true };
          }
        } catch {
          // Keep the dashed direct-distance estimate when private road routing is unavailable.
        } finally {
          routeRequests.current.delete(responder.id);
        }
        routeCache.current.set(responder.id, { route, origin: caller, responder: destination, checkedAt: Date.now() });
        next[responder.id] = route;
      }));
      if (active) setRoutes((current) => ({ ...current, ...next }));
    };
    void updateRoutes();
    return () => { active = false; };
  }, [alertId, caller, data?.responders]);

  const mapResponders: MapResponder[] = useMemo(() => (data?.responders ?? []).map((responder) => {
    const route = responder.location
      ? routes[responder.id] ?? (caller ? directEstimate(responder.location, caller) : undefined)
      : undefined;
    return { ...responder, route };
  }), [caller, data?.responders, routes]);
  const nearest = mapResponders
    .filter((responder) => (responder.status === "en_route" || responder.status === "on_scene") && responder.location && responder.route)
    .sort((a, b) => (a.route?.distanceM ?? Infinity) - (b.route?.distanceM ?? Infinity))[0];
  const onTheWay = data?.responders.filter((responder) => responder.status === "en_route").length ?? 0;
  const onScene = data?.responders.some((responder) => responder.status === "on_scene") ?? false;
  const accepted = data?.responders.length ?? 0;
  const locationCapturedAt = data?.alert.lastLocationAt ?? data?.alert.locAt;
  const callerLocationAgeSeconds = locationCapturedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(locationCapturedAt)) / 1000))
    : null;

  async function cancelAlert() {
    if (!(await confirm("Cancel this alert as a false alarm? Responders will be notified immediately.", {
      title: "Cancel emergency alert?",
      confirmLabel: "Cancel alert",
      danger: true,
    }))) return;
    setCancelBusy(true);
    try {
      const response = await fetch("/api/account/sos/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(body.error === "alert_already_resolved" ? "This alert has already been closed." : "The alert could not be cancelled. Try again.");
        return;
      }
      await refresh();
    } catch {
      setLoadError("The alert could not be cancelled. Check your connection and try again.");
    } finally {
      setCancelBusy(false);
    }
  }

  const progressStep = closed ? 3 : onScene ? 2 : onTheWay ? 1 : accepted ? 1 : 0;
  const currentStatus = falseAlarm
    ? "Alert cancelled"
    : closed
      ? "Alert closed"
      : onScene
        ? "Responder is with you"
        : onTheWay
          ? "Help is on the way"
          : accepted
            ? "Responder acknowledged"
            : "Finding a responder";
  const statusDetail = closed
    ? "Location sharing has stopped."
    : !caller
      ? "Waiting for a fresh location from your device."
      : onScene
        ? "A responder is at your location."
        : onTheWay
        ? `${onTheWay} responder${onTheWay === 1 ? "" : "s"} en route.`
        : accepted
          ? `${accepted} responder${accepted === 1 ? "" : "s"} acknowledged · travel not confirmed.`
          : "Nearby responders are being notified.";
  const progressSteps = [
    { title: "Alert sent", detail: data?.alert.triggeredAt ? new Date(data.alert.triggeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Your location is live" },
    { title: "Responder accepted", detail: nearest?.name ?? (accepted ? `${accepted} responder${accepted === 1 ? "" : "s"} responding` : "") },
    { title: "Arrived at your location", detail: onScene ? "A responder is with you" : "" },
    { title: "Alert closed", detail: falseAlarm ? "Cancelled as a false alarm" : "" },
  ];

  return <section className="kiki-sos-response" role="dialog" aria-modal="true" aria-labelledby="kiki-response-title">
    <MapScreen
      screenId={`sos-response-${alertId}`}
      className="kiki-sos-response-map"
      map={<ResponseMap caller={caller} responders={mapResponders} layer={mapLayer} recenter={mapRecenter} />}
      topBar={<header className="kiki-sos-response-header">
        <div className="kiki-sos-response-title">
          <span className={`kiki-sos-live-dot${closed ? " is-closed" : ""}`} />
          <div><h1 id="kiki-response-title">{type === "medical" ? "Medical emergency" : "Kiki emergency alert"}</h1><p>Ref {alertId.slice(0, 8).toUpperCase()}</p></div>
        </div>
        <button type="button" className="kiki-sos-close" onClick={onClose} aria-label={closed ? "Back" : "Close this view"} title={closed ? "Back" : "Your alert stays active."}><ArrowLeft size={18} /></button>
      </header>}
      controls={<div className="kiki-sos-map-stat" role="status" aria-live="polite">
        <span className={`kiki-sos-map-status-icon${closed ? " is-closed" : ""}`}>
          {closed ? <Check size={17} /> : type === "medical" ? <HeartPulse size={17} /> : <Siren size={17} />}
        </span>
        <div className="kiki-sos-map-status-copy">
          <small>Live status</small>
          <b>{currentStatus}</b>
          <span>{statusDetail}</span>
        </div>
        {nearest && <div className="kiki-sos-map-arrival">
          <small>{nearest.status === "on_scene" ? "Responder status" : "Estimated arrival"}</small>
          <b><Clock3 size={15} />{formatResponseEta(nearest.route, nearest.status)}</b>
          <span>{nearest.route!.roadRoute ? "Road distance" : "Approx. distance"} · {nearest.route!.roadRoute ? "" : "~"}{formatDistance(nearest.route!.distanceM)}</span>
        </div>}
      </div>}
      onRecenter={() => setMapRecenter((value) => value + 1)}
      selectedLayer={mapLayer}
      onLayerChange={setMapLayer}
      hiddenActions={!closed && <button type="button" className="map-screen-sos kiki-sos-hidden-cancel" disabled={cancelBusy} onClick={() => void cancelAlert()}><Siren size={17} />{cancelBusy ? "Notifying…" : "Cancel alert"}</button>}
      bottomSheet={<MapBottomSheet level={sheetLevel} onLevelChange={setSheetLevel} label="Emergency response details" className="kiki-sos-response-sheet">
        <div className="kiki-sos-sheet-peek">
          <span className={`kiki-sos-peek-icon${closed ? " is-closed" : ""}`}>{closed ? <Check size={18} /> : type === "medical" ? <HeartPulse size={18} /> : <Siren size={18} />}</span>
          <div><strong>{currentStatus}</strong><small>{nearest ? `${nearest.name} · ${formatResponseEta(nearest.route, nearest.status)}` : statusDetail}</small></div>
        </div>
        <section className="kiki-sos-status-panel">
          <h2>Status</h2>
          <p>
            {falseAlarm ? "Your false-alarm update is recorded and responders have been notified."
              : closed ? "This alert is no longer active. Your location is no longer shared."
                : onScene ? "A responder is with you. Their location stays visible here until the incident is closed."
                  : onTheWay ? "A responder is on the way. Stay somewhere safe if you can; their progress updates here."
                    : accepted ? "A responder has acknowledged your alert. Their movement will appear here as they travel."
                      : "We’re alerting responders near you. You’ll see their updates here when one accepts."}
          </p>
          {loadError && <p className="kiki-sos-inline-error" role="status"><RefreshCw size={14} />{loadError}</p>}
          {trackingError && <p className="kiki-sos-inline-error" role="status">{trackingError}</p>}
          {!closed && <p className="kiki-sos-gps" role="status">
            {data?.alert.accuracyM != null ? `GPS accuracy about ±${Math.round(data.alert.accuracyM)} m.` : "Waiting for GPS accuracy."}
            {callerLocationAgeSeconds != null && ` Updated ${callerLocationAgeSeconds}s ago.`}
          </p>}
          {loading && !data && <p className="kiki-sos-gps">Connecting to your responders…</p>}
          <ol className="kiki-sos-timeline">
            {progressSteps.map((step, index) => <li key={step.title} className={index <= progressStep ? "is-current" : ""}>
              <span>{index < progressStep ? <Check size={11} /> : null}</span>
              <div>{step.title}{step.detail && index <= progressStep && <small>{step.detail}</small>}</div>
            </li>)}
          </ol>
        </section>
        {nearest && <section className="kiki-sos-nearest-panel">
          <span className="kiki-sos-responder-avatar">{nearest.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div><small>{nearest.status === "on_scene" ? "Responder arrived" : "Nearest responder"}</small><h2>{nearest.name}</h2><p>{[nearest.role, nearest.organisation].filter(Boolean).join(" · ") || "Kiki responder"}</p><small>{nearest.route!.roadRoute ? "ETA uses road routing; live traffic may not be available." : "Distance and ETA are estimates; road routing and live traffic are unavailable."}</small></div>
        </section>}
        {!nearest && !closed && <section className="kiki-sos-team-empty"><strong>Responders</strong><p>{accepted ? "Responders acknowledged your alert, but no one has confirmed they are travelling yet." : "Waiting for a responder to acknowledge your alert."}</p></section>}
        {mapResponders.length > 0 && <section className="kiki-sos-team-panel">
          <h2>Response team</h2>
          <ul>{mapResponders.map((responder) => <li key={responder.id}>
            <span className="kiki-sos-team-dot" />
            <div><strong>{responder.name}</strong><small>{[responder.role, responder.organisation].filter(Boolean).join(" · ")}</small><small>{statusCopy[responder.status] ?? responder.status.replaceAll("_", " ")}</small></div>
            <span className="kiki-sos-team-eta">{responder.route && responder.status !== "acknowledged" ? <>{responder.route.roadRoute ? "" : "~"}{formatDistance(responder.route.distanceM)}<small>{formatResponseEta(responder.route, responder.status)}</small></> : responder.status === "acknowledged" ? "Not travelling yet" : responder.location ? "Updating route…" : "Location unavailable"}</span>
          </li>)}</ul>
        </section>}
        {closed && <section className="kiki-sos-complete-panel">
          <strong><Check size={18} />{falseAlarm ? "Alert cancelled" : "Response complete"}</strong>
          <p>This alert is no longer active.</p>
          <div><span>Responders<b>{accepted}</b></span><span>Closed<b>{data?.alert.updatedAt ? new Date(data.alert.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</b></span></div>
        </section>}
        {!closed && <p className="kiki-sos-privacy-note"><ShieldCheck size={17} /><span>Your location is shared only with responders on this alert, and stops when it closes.</span></p>}
        <footer className="kiki-sos-response-footer">
          {closed ? <><Link href="/account/calm/winds?mode=quiet" className="kiki-sos-secondary-link">Need a minute? <span>Gentle Winds</span></Link><button type="button" className="kiki-sos-primary-action" onClick={onClose}><Check size={18} />Done</button></> : <>
            <button type="button" className="kiki-sos-primary-action" disabled={changingType} onClick={onChangeType}>
              {changingType ? <RefreshCw size={16} className="animate-spin" /> : type === "sos" ? <HeartPulse size={17} /> : <Siren size={17} />}
              {changingType ? "Updating alert…" : type === "sos" ? "Update to a medical emergency" : "Change alert type"}
            </button>
            <button type="button" className="kiki-sos-cancel-action" disabled={cancelBusy} onClick={() => void cancelAlert()}>
              <Siren size={15} />{cancelBusy ? "Notifying responders…" : "Cancel · false alarm"}
            </button>
          </>}
          {typeChangeError && <p className="kiki-sos-inline-error" role="alert">{typeChangeError}</p>}
        </footer>
      </MapBottomSheet>}
    />
  </section>;
}
