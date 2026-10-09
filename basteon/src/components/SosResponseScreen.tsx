"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, Check, Clock3, HeartPulse, MapPin, Navigation, RefreshCw, Siren } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SosType } from "@/lib/sos/sosGesture";
import type { MapPoint, MapResponder, ResponseRoute } from "./SosResponseMap";

const ResponseMap = dynamic(() => import("./SosResponseMap"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[300px] place-items-center bg-slate-100 text-sm text-slate-500">Preparing your live map…</div>,
});

type ResponseData = {
  alert: { id: string; status: string; typeCode: string | null; lat: number | null; lng: number | null; triggeredAt: string; updatedAt: string };
  responders: Array<{ id: string; name: string; status: string; acceptedAt: string; location: (MapPoint & { seenAt: string }) | null }>;
};
type RouteCacheEntry = { route: ResponseRoute; origin: MapPoint; responder: MapPoint; checkedAt: number };

const statusCopy: Record<string, string> = {
  acknowledged: "Accepted your alert",
  en_route: "On the way",
  on_scene: "Arrived at your location",
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

function formatEta(seconds: number | null, responderStatus?: string) {
  if (responderStatus === "on_scene") return "On scene";
  if (seconds == null) return "ETA unavailable";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${minutes} min`;
}

function directEstimate(origin: MapPoint, destination: MapPoint): ResponseRoute {
  const distanceM = Math.round(distanceMeters(origin, destination));
  return {
    points: [origin, destination],
    distanceM,
    durationS: Math.max(60, Math.round(distanceM / (30_000 / 3_600))),
    roadRoute: false,
  };
}

async function responderLocationUpdate(alertId: string): Promise<string | null> {
  if (!navigator.geolocation) return "Location is unavailable on this device.";
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(async (position) => {
    const speed = Number.isFinite(position.coords.speed ?? NaN) ? position.coords.speed : null;
    const speedKmh = speed == null ? null : speed * 3.6;
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
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed_kmh: speedKmh == null ? undefined : Number(speedKmh.toFixed(1)),
          heading_deg: Number.isFinite(position.coords.heading ?? NaN) ? Math.round((position.coords.heading! + 360) % 360) : undefined,
          motion_state: motion.motion_state,
          is_moving: motion.is_moving,
          hdop: Number.isFinite(position.coords.accuracy) ? Number(Math.max(0, Math.min(99, position.coords.accuracy / 5)).toFixed(1)) : undefined,
          fix_age_s: 0,
        }),
      });
      if (response.ok) return resolve(null);
      const result = await response.json().catch(() => ({}));
      resolve(result.error === "closed_alert" ? null : "Live location is delayed; updates will retry.");
    } catch {
      resolve("Live location is delayed; updates will retry.");
    }
  }, () => resolve("Could not read your location. Check device location permission."), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 2_000 }));
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
  const [data, setData] = useState<ResponseData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [trackingError, setTrackingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelBusy, setCancelBusy] = useState(false);
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
    const updateLocation = () => {
      void responderLocationUpdate(alertId).then((message) => {
        if (active) setTrackingError(message ?? "");
      });
    };
    updateLocation();
    const locationTimer = window.setInterval(updateLocation, 5_000);
    return () => {
      active = false;
      window.clearInterval(locationTimer);
    };
  }, [alertId, closed]);

  const caller = useMemo<MapPoint | null>(() => {
    if (data?.alert.lat == null || data.alert.lng == null) return null;
    return { lat: data.alert.lat, lng: data.alert.lng };
  }, [data?.alert.lat, data?.alert.lng]);

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
    .filter((responder) => responder.location && responder.route)
    .sort((a, b) => (a.route?.distanceM ?? Infinity) - (b.route?.distanceM ?? Infinity))[0];
  const onTheWay = data?.responders.filter((responder) => responder.status === "en_route").length ?? 0;
  const onScene = data?.responders.some((responder) => responder.status === "on_scene") ?? false;
  const accepted = data?.responders.length ?? 0;

  async function cancelAlert() {
    if (!window.confirm("Cancel this alert as a false alarm? Responders will be notified immediately.")) return;
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

  return (
    <main className="fixed inset-0 z-[2000] flex flex-col overflow-y-auto bg-[#f4f7f5] text-[#172421]" role="dialog" aria-modal="true" aria-label="Live emergency response">
      <header className="flex items-center justify-between gap-3 border-b border-[#dce5e0] bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${type === "medical" ? "bg-[#e6f4f2] text-[#087f70]" : "bg-[#fff0ee] text-[#d74242]"}`}>
            {type === "medical" ? <HeartPulse size={22} /> : <Siren size={22} />}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold sm:text-lg">{falseAlarm ? "Alert cancelled" : closed ? "Alert closed" : "Help is finding its way to you"}</h1>
            <p className="text-xs text-[#64736e]">{type === "medical" ? "Medical emergency" : "Kiki emergency alert"} · Ref {alertId.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>
        {closed && <button className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-[#dce5e0] px-3 text-sm font-semibold hover:bg-[#f4f7f5]" onClick={onClose}>
          <ArrowLeft size={16} /><span>Back</span>
        </button>}
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] flex-1 gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-h-[360px] flex-col overflow-hidden rounded-3xl border border-[#dce5e0] bg-white shadow-sm lg:min-h-[calc(100vh-120px)]">
          <div className="flex items-center justify-between gap-2 border-b border-[#e7eeea] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold"><MapPin size={17} className="text-[#0f766e]" />Your live response map</div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5ee] px-2.5 py-1 text-[11px] font-bold text-[#217346]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#2ea66b]" />LIVE</span>
          </div>
          <div className="relative min-h-[320px] flex-1">
            <ResponseMap caller={caller} responders={mapResponders} />
            {(!caller || accepted === 0) && !closed && (
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-2xl bg-white/95 px-4 py-3 text-sm font-semibold shadow-md">
                {!caller ? "Waiting for a fresh location from your device." : "Your alert is reaching nearby responders. Their updates will appear here."}
              </div>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-3xl border border-[#dce5e0] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              {closed ? <Check size={19} className="text-[#217346]" /> : <Navigation size={19} className="text-[#0f766e]" />}
              <h2 className="font-bold">{falseAlarm ? "Responders have been notified" : closed ? "Response complete" : accepted ? `${accepted} responder${accepted === 1 ? "" : "s"} responding` : "Alert sent to responders"}</h2>
            </div>
            <p className="text-sm leading-6 text-[#64736e]">
              {falseAlarm
                ? "Your false-alarm update is recorded and the responder dashboards have been updated."
                : closed
                  ? "This alert is no longer active."
                  : onScene
                    ? "A responder is with you. Their location will stay visible here until the incident is closed."
                    : onTheWay
                    ? "A responder is on the way. Stay somewhere safe if you can; your response map updates as they move."
                    : accepted
                      ? "A responder has acknowledged your alert. Their movement will appear here when their live location updates."
                      : "Kiki is sharing your alert with the appropriate responders. We’ll show their progress here as soon as someone accepts."}
            </p>
            {loadError && <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status"><RefreshCw size={14} />{loadError}</p>}
            {trackingError && <p className="mt-2 text-xs text-amber-800" role="status">{trackingError}</p>}
            {loading && !data && <p className="mt-3 text-xs text-[#64736e]">Connecting to your responders…</p>}
          </section>

          {nearest && (
            <section className="rounded-3xl border border-[#cfe4da] bg-[#edf7f2] p-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#3c6e59]">Closest responder</p>
              <h2 className="text-lg font-bold">{nearest.name}</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase text-[#71817b]">Distance</p><p className="mt-1 font-bold">{formatDistance(nearest.route!.distanceM)}</p></div>
                <div className="rounded-2xl bg-white px-3 py-2"><p className="text-[10px] font-semibold uppercase text-[#71817b]">Estimated arrival</p><p className="mt-1 inline-flex items-center gap-1 font-bold"><Clock3 size={14} />{formatEta(nearest.route!.durationS, nearest.status)}</p></div>
              </div>
              {!nearest.route!.roadRoute && <p className="mt-2 text-[10px] leading-4 text-[#687972]">Approximate straight-line estimate. Road routing is unavailable; actual distance and arrival time may differ.</p>}
            </section>
          )}

          <section className="rounded-3xl border border-[#dce5e0] bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-bold">Responders</h2>
            {mapResponders.length ? (
              <ul className="space-y-3">
                {mapResponders.map((responder) => (
                  <li key={responder.id} className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#0f766e]" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{responder.name}</p>
                      <p className="text-xs text-[#64736e]">{statusCopy[responder.status] ?? responder.status.replaceAll("_", " ")}</p>
                    </div>
                    {responder.route ? <span className="text-right text-xs font-semibold">{formatDistance(responder.route.distanceM)}<br /><span className="text-[#64736e]">{formatEta(responder.route.durationS, responder.status)}</span></span> : <span className="text-right text-xs text-[#64736e]">{responder.location ? "Updating route…" : "Location updating"}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm leading-6 text-[#64736e]">Waiting for a responder to accept. You’ll see their status and location here.</p>}
          </section>

          {!closed ? (
            <section className="rounded-3xl border border-[#f2d2d0] bg-white p-5 shadow-sm">
              <h2 className="font-bold text-[#9d2828]">Was this a false alarm?</h2>
              <p className="mt-1 text-xs leading-5 text-[#64736e]">Cancel only if you no longer need emergency help. Responders will be notified immediately.</p>
              <button className="mt-3 w-full rounded-xl bg-[#b83232] px-4 py-3 text-sm font-bold text-white hover:bg-[#982b2b] disabled:opacity-60" disabled={cancelBusy} onClick={() => void cancelAlert()}>
                {cancelBusy ? "Notifying responders…" : "Cancel alert · false alarm"}
              </button>
            </section>
          ) : (
            <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-4 py-3 text-sm font-bold text-white" onClick={onClose}><Check size={17} />Done</button>
          )}

          {!closed && (
            <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#dce5e0] bg-white px-4 py-3 text-xs font-semibold text-[#596a64] hover:bg-[#f4f7f5] disabled:opacity-60" disabled={changingType} onClick={onChangeType}>
              {changingType ? <RefreshCw size={15} className="animate-spin" /> : type === "sos" ? <HeartPulse size={15} /> : <Siren size={15} />}
              {changingType ? "Updating alert…" : type === "sos" ? "Update to a medical emergency" : "Change alert type"}
            </button>
          )}
          {typeChangeError && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{typeChangeError}</p>}
        </aside>
      </div>
    </main>
  );
}
