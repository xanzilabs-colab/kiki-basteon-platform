"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, Check, Clock3, HeartPulse, RefreshCw, ShieldCheck, Siren } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SosType } from "@/lib/sos/sosGesture";
import { estimateResponseRoute, formatResponseEta } from "@/lib/sos/responseRoute";
import type { MapPoint, MapResponder, ResponseRoute } from "./SosResponseMap";
import { useAppDialog } from "@/components/AppDialogProvider";

const ResponseMap = dynamic(() => import("./SosResponseMap"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[300px] place-items-center bg-slate-100 text-sm text-slate-500">Preparing your live map…</div>,
});

type ResponseData = {
  alert: { id: string; status: string; typeCode: string | null; lat: number | null; lng: number | null; triggeredAt: string; updatedAt: string };
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
  const { confirm } = useAppDialog();
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
    .filter((responder) => (responder.status === "en_route" || responder.status === "on_scene") && responder.location && responder.route)
    .sort((a, b) => (a.route?.distanceM ?? Infinity) - (b.route?.distanceM ?? Infinity))[0];
  const onTheWay = data?.responders.filter((responder) => responder.status === "en_route").length ?? 0;
  const onScene = data?.responders.some((responder) => responder.status === "on_scene") ?? false;
  const accepted = data?.responders.length ?? 0;

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
          : "Finding a responder";
  const progressSteps = [
    { title: "Alert sent", detail: data?.alert.triggeredAt ? new Date(data.alert.triggeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Your location is live" },
    { title: "Responder accepted", detail: nearest?.name ?? (accepted ? `${accepted} responder${accepted === 1 ? "" : "s"} responding` : "") },
    { title: "Arrived at your location", detail: onScene ? "A responder is with you" : "" },
    { title: "Alert closed", detail: falseAlarm ? "Cancelled as a false alarm" : "" },
  ];

  return (
    <main className="fixed inset-0 z-[2000] flex items-center justify-center overflow-hidden bg-[#d9cde8] text-[#2a1536]" role="dialog" aria-modal="true" aria-label="Live emergency response">
      <div className="flex h-[100dvh] w-full max-w-[480px] flex-col overflow-hidden bg-[#f3eefb] shadow-2xl sm:rounded-[32px]">
        <header className={`flex shrink-0 items-center gap-3 px-[18px] pb-3 pt-[max(24px,env(safe-area-inset-top))] ${falseAlarm ? "text-[#522868]" : closed ? "text-[#522868]" : ""}`}>
          <span className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[15px] ${falseAlarm || closed ? "bg-[#e9dcf0] text-[#522868]" : onTheWay || onScene ? "bg-[#e6f3f0] text-[#12766a]" : "bg-[#fdeaee] text-[#d9435f]"}`}>
            {closed ? <Check size={23} /> : type === "medical" ? <HeartPulse size={23} /> : <Siren size={23} />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-extrabold leading-tight tracking-[-.02em]">{currentStatus}</h1>
            <p className="mt-0.5 truncate text-xs text-[#6e5a7c]">{type === "medical" ? "Medical emergency" : "Kiki emergency alert"} · Ref {alertId.slice(0, 8).toUpperCase()}</p>
          </div>
          <button className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[#e6dcf0] bg-white px-3 text-xs font-semibold hover:bg-[#e9dcf0]" onClick={onClose} title={closed ? undefined : "Close this view. Your alert stays active."}>
            <ArrowLeft size={15} /><span>{closed ? "Back" : "Close"}</span>
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-[14px] pb-4">
          <section className="relative h-[250px] shrink-0 overflow-hidden rounded-[22px] border border-[#e6dcf0] bg-white">
            <div className="absolute left-2.5 top-2.5 z-[500] inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#12766a] shadow-sm">
              <span className={`h-[7px] w-[7px] rounded-full ${closed ? "bg-[#b9a9c7]" : "animate-pulse bg-[#12766a]"}`} />{closed ? "ENDED" : "LIVE"}
            </div>
            <div className="h-full w-full"><ResponseMap caller={caller} responders={mapResponders} /></div>
            {(!caller || accepted === 0) && !closed && (
              <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 rounded-2xl bg-white/95 px-3.5 py-2.5 text-xs font-semibold shadow-md">
                {!caller ? "Waiting for a fresh location from your device." : "Your alert is reaching nearby responders. Their updates will appear here."}
              </div>
            )}
            {nearest && <div className="absolute bottom-2.5 left-2.5 right-2.5 z-[500] flex items-center justify-between rounded-2xl bg-white px-3.5 py-2.5 shadow-md">
              <div><small className="block text-[10px] text-[#6e5a7c]">{nearest.route!.roadRoute ? "Road distance" : "Approx. distance"}</small><b className="text-lg">{nearest.route!.roadRoute ? "" : "~"}{formatDistance(nearest.route!.distanceM)}</b></div>
              <div className="text-right"><small className="block text-[10px] text-[#6e5a7c]">Estimated arrival</small><b className="inline-flex items-center gap-1 text-lg"><Clock3 size={15} />{formatResponseEta(nearest.route, nearest.status)}</b></div>
            </div>}
          </section>

          <section className="rounded-[22px] border border-[#e6dcf0] bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[#6e5a7c]">Status</p>
            <p className="mt-2 text-sm leading-5">
              {falseAlarm
                ? "Your false-alarm update is recorded and responders have been notified."
                : closed
                  ? "This alert is no longer active. Your location is no longer shared."
                  : onScene
                    ? "A responder is with you. Their location stays visible here until the incident is closed."
                    : onTheWay
                      ? "A responder is on the way. Stay somewhere safe if you can; their progress updates here."
                      : accepted
                        ? "A responder has acknowledged your alert. Their movement will appear here as they travel."
                        : "We’re alerting responders near you. You’ll see their updates here when one accepts."}
            </p>
            {loadError && <p className="mt-3 flex items-center gap-2 rounded-xl bg-[#fdeaee] px-3 py-2 text-xs text-[#7d3341]" role="status"><RefreshCw size={14} />{loadError}</p>}
            {trackingError && <p className="mt-2 text-xs text-[#7d3341]" role="status">{trackingError}</p>}
            {loading && !data && <p className="mt-2 text-xs text-[#6e5a7c]">Connecting to your responders…</p>}
            <ol className="mt-3 list-none p-0">
              {progressSteps.map((step, index) => (
                <li key={step.title} className={`relative flex gap-3 pb-3 text-[13px] last:pb-0 ${index <= progressStep ? "text-[#2a1536]" : "text-[#8c7b98]"}`}>
                  {index < progressSteps.length - 1 && <span className={`absolute bottom-0 left-[8px] top-[18px] w-0.5 ${index < progressStep ? "bg-[#12766a]" : "bg-[#e6dcf0]"}`} />}
                  <span className={`z-10 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${index < progressStep ? "border-[#12766a] bg-[#12766a] text-white" : index === progressStep ? "border-[#12766a] bg-white" : "border-[#e6dcf0] bg-white"}`}>{index < progressStep && <Check size={11} />}</span>
                  <span className={index === progressStep ? "font-semibold" : ""}>{step.title}{step.detail && index <= progressStep && <small className="mt-0.5 block text-xs font-normal text-[#6e5a7c]">{step.detail}</small>}</span>
                </li>
              ))}
            </ol>
          </section>

          {nearest ? (
            <section className="rounded-[22px] border border-[#c9e5db] bg-[#e6f3f0] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[#12766a]">{nearest.status === "on_scene" ? "Responder arrived" : "Nearest responder"}</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#12766a] text-sm font-bold text-white">{nearest.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                <div className="min-w-0 flex-1"><h2 className="text-[16px] font-bold">{nearest.name}</h2><p className="text-xs text-[#6e5a7c]">{[nearest.role, nearest.organisation].filter(Boolean).join(" · ") || "Kiki responder"}</p></div>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-[#6e5a7c]">{nearest.route!.roadRoute ? "ETA uses road routing; live traffic data may not be available." : "Distance and ETA are estimates; road routing and live traffic are unavailable."}</p>
            </section>
          ) : !closed && (
            <section className="rounded-[22px] border border-[#e6dcf0] bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-[.08em] text-[#6e5a7c]">Responders</p>
              <p className="mt-2 text-sm leading-5 text-[#6e5a7c]">{accepted ? "Responders acknowledged your alert, but no one has confirmed they are travelling yet." : "Waiting for a responder to acknowledge your alert."}</p>
            </section>
          )}

          {mapResponders.length > 0 && (
            <section className="rounded-[22px] border border-[#e6dcf0] bg-white p-4">
              <h2 className="mb-3 font-bold">Response team</h2>
              <ul className="space-y-3">
                {mapResponders.map((responder) => (
                  <li key={responder.id} className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#12766a]" />
                    <div className="min-w-0 flex-1"><p className="font-semibold">{responder.name}</p><p className="text-xs text-[#6e5a7c]">{[responder.role, responder.organisation].filter(Boolean).join(" · ")}</p><p className="text-xs text-[#6e5a7c]">{statusCopy[responder.status] ?? responder.status.replaceAll("_", " ")}</p></div>
                    {responder.route && responder.status !== "acknowledged" ? <span className="text-right text-xs font-semibold">{responder.route.roadRoute ? "" : "~"}{formatDistance(responder.route.distanceM)}<br /><span className="text-[#6e5a7c]">{formatResponseEta(responder.route, responder.status)}</span></span> : <span className="text-right text-xs text-[#6e5a7c]">{responder.status === "acknowledged" ? "Not travelling yet" : responder.location ? "Updating route…" : "Location unavailable"}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {closed && (
            <section className="rounded-[22px] border border-[#e6dcf0] bg-white p-4">
              <p className="flex items-center gap-2 text-[16px] font-bold text-[#12766a]"><Check size={19} />{falseAlarm ? "Alert cancelled" : "Response complete"}</p>
              <p className="mt-1 text-sm text-[#6e5a7c]">This alert is no longer active.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[14px] bg-[#f3eefb] p-3"><span className="text-[10px] font-bold uppercase text-[#6e5a7c]">Responders</span><b className="mt-1 block text-lg">{accepted}</b></div>
                <div className="rounded-[14px] bg-[#f3eefb] p-3"><span className="text-[10px] font-bold uppercase text-[#6e5a7c]">Closed</span><b className="mt-1 block text-lg">{data?.alert.updatedAt ? new Date(data.alert.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</b></div>
              </div>
            </section>
          )}

          {!closed && <div className="flex items-start gap-2 rounded-[22px] border border-[#e6dcf0] bg-white p-4 text-[13px] leading-5 text-[#6e5a7c]"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-[#12766a]" /><span>Your location is shared only with responders on this alert, and stops when it closes.</span></div>}
        </div>

        <footer className="flex shrink-0 flex-col gap-2 bg-gradient-to-b from-transparent via-[#f3eefb] to-[#f3eefb] px-[14px] pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
          {closed ? <button className="flex h-[54px] items-center justify-center gap-2 rounded-[17px] bg-[#522868] text-base font-bold text-white" onClick={onClose}><Check size={19} />Done</button> : <>
            <button className="flex h-[54px] items-center justify-center gap-2 rounded-[17px] bg-[#522868] text-base font-bold text-white disabled:opacity-60" disabled={changingType} onClick={onChangeType}>
              {changingType ? <RefreshCw size={16} className="animate-spin" /> : type === "sos" ? <HeartPulse size={17} /> : <Siren size={17} />}
              {changingType ? "Updating alert…" : type === "sos" ? "Update to a medical emergency" : "Change alert type"}
            </button>
            <button className="flex h-10 items-center justify-center gap-2 rounded-[17px] text-sm font-semibold text-[#d9435f] disabled:opacity-60" disabled={cancelBusy} onClick={() => void cancelAlert()}>
              <Siren size={15} />{cancelBusy ? "Notifying responders…" : "Cancel · false alarm"}
            </button>
          </>}
          {typeChangeError && <p className="rounded-xl bg-[#fdeaee] px-3 py-2 text-xs text-[#7d3341]" role="alert">{typeChangeError}</p>}
        </footer>
      </div>
    </main>
  );
}
