"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bus, Car, CheckCircle2, ChevronRight, Clock3, Flag, Footprints, History, LocateFixed, MapPinned, Navigation, ShieldCheck, Timer, TrainFront, UsersRound } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { formatDistance } from "@/lib/geo";
import { remainingRouteDurationS } from "@/lib/hamba/geometry";
import type { TripMode } from "@/lib/hamba/types";
import { evaluateRouteWatch } from "@/lib/hamba/routeWatch";
import type { GeoPoint, RouteWatchState } from "@/lib/hamba/types";
import { enablePushNotifications } from "@/lib/usePushNotifications";

const TripMap = dynamic(() => import("@/components/TripMap"), { ssr: false, loading: () => <div className="hamba-map hamba-map-loading">Loading map...</div> });
type Place = { label: string; lat: number; lng: number };
type Route = { points: Place[]; distanceM: number; durationS: number };
type ActiveTrip = { id: string; destination_label: string; destination_lat: number; destination_lng: number; mode: TripMode; planned_route: Route; route_distance_m: number; route_duration_s: number; started_at: string; expected_arrival_at: string; next_check_in_at: string | null; status: string };
type RecentTrip = { id: string; destination_label: string; destination_lat: number; destination_lng: number; mode: TripMode; status: string; created_at: string; ended_at: string | null };
const transitModes = [
  { value: "taxi", label: "Taxi", icon: Bus },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "ehail", label: "Ehail", icon: Car },
  { value: "bus", label: "Bus", icon: Bus },
  { value: "train", label: "Train", icon: TrainFront },
] as const;

export default function TripsPage() {
  const { position, error: locationError } = useGeolocation();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<TripMode>("taxi");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [recenter, setRecenter] = useState(0);
  const fixes = useRef<GeoPoint[]>([]);
  const previousWatchState = useRef<RouteWatchState>("normal");

  useEffect(() => {
    fetch("/api/trips").then((response) => response.json()).then((data) => { setActiveTrip(data.trip ?? null); setRecentTrips(data.recent ?? []); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeTrip) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeTrip?.id]);

  useEffect(() => {
    if (query.trim().length < 3 || destination) return setPlaces([]);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/trips/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), signal: controller.signal });
        if (response.ok && !controller.signal.aborted) setPlaces(await response.json());
      } catch { if (!controller.signal.aborted) setMessage("Destination search is unavailable. Please try again."); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, destination]);

  useEffect(() => {
    if (!destination || !position) return;
    setRoutes([]);
    setMessage("");
    const controller = new AbortController();
    fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode }), signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { setRoutes(data.routes); setSelectedRoute(0); })
      .catch(() => { if (!controller.signal.aborted) setMessage("Route planning is unavailable. Try again when you have data coverage."); });
    return () => controller.abort();
  }, [destination, mode, position?.lat, position?.lng]);

  useEffect(() => {
    if (!activeTrip || !position) return;
    const fix: GeoPoint = { lat: position.lat, lng: position.lng, accuracyM: position.accuracy, timestamp: Date.now() };
    fixes.current = [...fixes.current, fix].slice(-60);
    const heartbeat = window.setTimeout(() => {
      void fetch(`/api/trips/${activeTrip.id}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: position.lat, lng: position.lng, accuracyM: position.accuracy }) })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          if (!data) return;
          setActiveTrip((current) => current?.id === activeTrip.id ? { ...current, expected_arrival_at: data.expectedArrivalAt, next_check_in_at: data.nextCheckInAt } : current);
        });
      const result = evaluateRouteWatch({
        mode: activeTrip.mode,
        route: { ...activeTrip.planned_route, points: activeTrip.planned_route.points.map((point) => ({ ...point, timestamp: 0 })), alternatives: [] },
        fixes: fixes.current,
        startedAt: new Date(activeTrip.started_at).getTime(),
        expectedArrivalAt: new Date(activeTrip.expected_arrival_at).getTime(),
        lastCheckInAt: activeTrip.next_check_in_at ? new Date(activeTrip.next_check_in_at).getTime() - 15 * 60_000 : undefined,
        now: Date.now(),
        previousState: previousWatchState.current,
      });
      if (result.state !== previousWatchState.current) {
        previousWatchState.current = result.state;
        void fetch(`/api/trips/${activeTrip.id}/watch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
      }
    }, 250);
    return () => window.clearTimeout(heartbeat);
  }, [activeTrip?.id, position?.lat, position?.lng]);

  const route = activeTrip?.planned_route ?? routes[selectedRoute];
  const etaMinutes = route ? Math.max(1, Math.ceil(route.durationS / 60)) : null;
  const activeRemainingMinutes = activeTrip && position
    ? Math.max(1, Math.ceil(remainingRouteDurationS({ ...position, timestamp: Date.now() }, { ...activeTrip.planned_route, points: activeTrip.planned_route.points.map((point) => ({ ...point, timestamp: 0 })), alternatives: [] }) / 60))
    : null;

  async function startTrip() {
    if (!destination || !route) return;
    setBusy(true);
    void enablePushNotifications();
    try {
      const response = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationLabel: destination.label, destination, mode, route }) });
      const data = await response.json();
      if (!response.ok) return setMessage(typeof data.error === "string" ? data.error : "Could not start your trip.");
      localStorage.setItem("hamba-active-route", JSON.stringify(route));
      fixes.current = [];
      previousWatchState.current = "normal";
      setNow(Date.now());
      setMessage("");
      setActiveTrip(data.trip);
    } catch { setMessage("Could not start your trip. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function checkIn() {
    if (!activeTrip) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/check-in`, { method: "POST" });
      if (!response.ok) return setMessage("Check-in could not be recorded. Please try again.");
      setMessage("Check-in recorded. Route Watch is still monitoring your trip.");
      const refreshed = await fetch("/api/trips");
      if (refreshed.ok) { const data = await refreshed.json(); setActiveTrip(data.trip ?? null); }
    } catch { setMessage("Check-in could not be confirmed. Check your connection."); }
    finally { setBusy(false); }
  }

  async function arrive() {
    if (!activeTrip) return;
    if (!window.confirm("Confirm that you have arrived safely.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/arrive`, { method: "POST" });
      if (!response.ok) return setMessage("Arrival could not be confirmed. Your trip remains active.");
      setRecentTrips((current) => [{ ...activeTrip, created_at: activeTrip.started_at, ended_at: new Date().toISOString(), status: "arrived" }, ...current].slice(0, 5));
      localStorage.removeItem("hamba-active-route"); setActiveTrip(null); setDestination(null); setRoutes([]); setQuery(""); setMessage("Trip ended. Glad you arrived safely.");
    } catch { setMessage("Arrival could not be confirmed. Your trip remains active."); }
    finally { setBusy(false); }
  }

  const checkInSeconds = activeTrip?.next_check_in_at ? Math.max(0, Math.ceil((new Date(activeTrip.next_check_in_at).getTime() - now) / 1_000)) : null;
  const countdown = checkInSeconds === null ? "Not scheduled" : `${String(Math.floor(checkInSeconds / 60)).padStart(2, "0")}:${String(checkInSeconds % 60).padStart(2, "0")}`;
  const destinations = recentTrips.filter((trip, index, items) => items.findIndex((item) => item.destination_label === trip.destination_label) === index);

  return (
    <div className="hamba-page">
      <div className="hamba-heading">
        <div><p className="eyebrow">{activeTrip ? "Live route watch" : "Personal safety"}</p><h1 className="page-title">{activeTrip ? "Active trip tracking" : "Plan a safe trip"}</h1></div>
        <span className={activeTrip ? "hamba-live" : "hamba-engine"}>{activeTrip ? <><i />{activeTrip.status === "active" ? "Trip active" : activeTrip.status}</> : "No active trip"}</span>
      </div>
      {activeTrip ? (
        <section className="hamba-active">
          <div className="hamba-map-stage">
            <TripMap points={activeTrip.planned_route.points} position={position} recenter={recenter} />
            <div className="hamba-map-overlay"><span className="hamba-overlay-icon"><ShieldCheck size={18} /></span><div><h2>{activeTrip.destination_label}</h2><p>{activeTrip.mode === "walk" ? "Walk" : "Taxi"} · {activeRemainingMinutes ?? Math.max(1, Math.ceil((new Date(activeTrip.expected_arrival_at).getTime() - now) / 60_000))} min estimated</p></div><button type="button" className="hamba-recenter" title="Center map on route" aria-label="Center map on route" onClick={() => setRecenter((current) => current + 1)}><LocateFixed size={18} /></button></div>
          </div>
          <div className="hamba-active-card">
            <div className="hamba-control-stats"><div><span>Next check-in</span><b><Timer size={20} />{countdown}</b></div><div><span>Planned distance</span><b>{formatDistance(activeTrip.route_distance_m / 1000)}</b></div></div>
            <div className="hamba-actions"><button className="btn" disabled={busy} onClick={() => void checkIn()}><CheckCircle2 size={16} />Check in now</button><button className="btn hamba-arrive" disabled={busy} onClick={() => void arrive()}><Flag size={16} />I've arrived</button></div>
            {!position && <p className="hamba-note"><LocateFixed size={16} />{locationError ?? "Waiting for your phone location."}</p>}
          </div>
        </section>
      ) : (
        <section className="hamba-planner">
          <label className="hamba-field-label" htmlFor="trip-destination">Where are you going?</label>
          <div className="hamba-search"><MapPinned size={19} /><input id="trip-destination" value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); setRoutes([]); }} placeholder="Type destination address..." autoComplete="off" /></div>
          {places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} onClick={() => { setDestination(place); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}
          <span className="hamba-field-label">Travel mode</span>
          <div className="hamba-mode" role="group" aria-label="Travel mode">{transitModes.map((item) => <button key={item.value} type="button" className={mode === item.value ? "active" : ""} aria-pressed={mode === item.value} disabled={item.value !== "taxi" && item.value !== "walk"} title={item.value !== "taxi" && item.value !== "walk" ? "Not available for Route Watch" : item.label} onClick={() => { if ((item.value === "taxi" || item.value === "walk") && item.value !== mode) { setRoutes([]); setMode(item.value); } }}><item.icon size={18} /><span>{item.label}</span>{item.value !== "taxi" && item.value !== "walk" && <small>Unavailable</small>}</button>)}</div>
          <div className="hamba-safety-options"><div><Clock3 size={18} /><div><span>Check-in frequency</span><b>Adaptive · up to 15 min</b></div></div><Link href="/account/guardians"><UsersRound size={18} /><div><span>Guardian Circle</span><b>Manage contacts</b></div><ChevronRight size={14} /></Link></div>
          {destination && <><div className="hamba-preview"><TripMap points={route?.points ?? []} position={position} /></div><div className="hamba-route-summary"><div><b>{route ? formatDistance(route.distanceM / 1000) : "-"}</b><span>Planned distance</span></div><div><b>{etaMinutes ?? "-"} min</b><span>Estimated time</span></div></div>{routes.length > 1 && <label className="hamba-field-label">Route option<select className="input" value={selectedRoute} onChange={(event) => setSelectedRoute(Number(event.target.value))}>{routes.map((option, index) => <option key={index} value={index}>Route {index + 1} · {formatDistance(option.distanceM / 1000)} · {Math.ceil(option.durationS / 60)} min</option>)}</select></label>}</>}
          <button className="btn btn-primary hamba-start" disabled={!destination || !position || !route || busy} onClick={() => void startTrip()}><Navigation size={17} />{busy ? "Starting..." : "Start active trip protection"}</button>
          {!position && <p className="hamba-note"><LocateFixed size={16} /> {locationError ?? "Enable location to plan a route."}</p>}
        </section>
      )}
      {!activeTrip && <section className="hamba-recent"><div className="hamba-recent-head"><h2><History size={18} />Recent destinations</h2></div>{destinations.map((trip) => <button type="button" className="hamba-recent-item" key={trip.id} onClick={() => { setDestination({ label: trip.destination_label, lat: trip.destination_lat, lng: trip.destination_lng }); setQuery(trip.destination_label); setMode(trip.mode); setRoutes([]); setPlaces([]); }}><span className="hamba-recent-dot" /><div><b>{trip.destination_label}</b><p>{trip.mode} · {trip.status === "arrived" ? "Arrived safely" : "Cancelled"}</p></div><ChevronRight size={17} /></button>)}{destinations.length === 0 && <p className="hamba-empty">Your completed trips will appear here.</p>}</section>}
      {message && <p className="hamba-message" role="status">{message}</p>}
    </div>
  );
}