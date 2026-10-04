"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Clock3, LocateFixed, MapPinned, Navigation, ShieldCheck } from "lucide-react";
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

export default function TripsPage() {
  const { position, error: locationError } = useGeolocation();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<TripMode>("taxi");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fixes = useRef<GeoPoint[]>([]);
  const previousWatchState = useRef<RouteWatchState>("normal");

  useEffect(() => {
    fetch("/api/trips").then((response) => response.json()).then((data) => setActiveTrip(data.trip ?? null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (query.trim().length < 3 || destination) return setPlaces([]);
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/trips/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      if (response.ok) setPlaces(await response.json());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, destination]);

  useEffect(() => {
    if (!destination || !position) return;
    const controller = new AbortController();
    fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode }), signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { setRoutes(data.routes); setSelectedRoute(0); })
      .catch(() => setMessage("Route planning is unavailable. Try again when you have data coverage."));
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
    const response = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationLabel: destination.label, destination, mode, route }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error ?? "Could not start your trip.");
    localStorage.setItem("hamba-active-route", JSON.stringify(route));
    fixes.current = [];
    previousWatchState.current = "normal";
    setActiveTrip(data.trip);
  }

  async function checkIn() {
    if (!activeTrip) return;
    await fetch(`/api/trips/${activeTrip.id}/check-in`, { method: "POST" });
    setMessage("Check-in recorded. Route Watch is still monitoring your trip.");
  }

  async function arrive() {
    if (!activeTrip) return;
    if (!window.confirm("Confirm that you have arrived safely.")) return;
    const response = await fetch(`/api/trips/${activeTrip.id}/arrive`, { method: "POST" });
    if (response.ok) { localStorage.removeItem("hamba-active-route"); setActiveTrip(null); setDestination(null); setRoutes([]); setQuery(""); setMessage("Trip ended. Glad you arrived safely."); }
  }

  return (
    <div className="hamba-page">
      <div className="hamba-heading">
        <div><p className="eyebrow">Hamba</p><h1 className="page-title">Trip safety</h1><p>Route Watch stays with you from departure to arrival.</p></div>
        <span className="hamba-engine"><ShieldCheck size={17} /> Route Watch</span>
      </div>
      {activeTrip ? (
        <section className="hamba-active">
          <TripMap points={activeTrip.planned_route.points} position={position} />
          <div className="hamba-active-card">
            <span className="hamba-live"><i /> Active trip</span>
            <h2>{activeTrip.destination_label}</h2>
            <div className="hamba-trip-stats"><span><Navigation size={16} /> {formatDistance(activeTrip.route_distance_m / 1000)}</span><span><Clock3 size={16} /> {activeRemainingMinutes ?? Math.max(1, Math.ceil((new Date(activeTrip.expected_arrival_at).getTime() - Date.now()) / 60_000))} min remaining</span></div>
            <p>Next check-in is due in {activeTrip.next_check_in_at ? Math.max(0, Math.ceil((new Date(activeTrip.next_check_in_at).getTime() - Date.now()) / 60_000)) : 0} min.</p>
            <div className="hamba-actions"><button className="btn" onClick={() => void checkIn()}>Check in</button><button className="btn btn-primary" onClick={() => void arrive()}>I've arrived</button></div>
          </div>
        </section>
      ) : (
        <section className="hamba-planner">
          <label className="hamba-search"><MapPinned size={19} /><input value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); }} placeholder="Where are you going?" autoComplete="off" /></label>
          {places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} onClick={() => { setDestination(place); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}
          <div className="hamba-mode" role="group" aria-label="Travel mode"><button className={mode === "taxi" ? "active" : ""} onClick={() => setMode("taxi")}>Taxi</button><button className={mode === "walk" ? "active" : ""} onClick={() => setMode("walk")}>Walk</button></div>
          {destination && <><div className="hamba-preview"><TripMap points={route?.points ?? []} position={position} /></div><div className="hamba-route-summary"><div><b>{formatDistance((route?.distanceM ?? 0) / 1000)}</b><span>Planned distance</span></div><div><b>{etaMinutes ?? "-"} min</b><span>Estimated time</span></div>{routes.length > 1 && <div><b>{routes.length}</b><span>Route options</span></div>}</div><button className="btn btn-primary hamba-start" disabled={!route || busy} onClick={() => void startTrip()}>{busy ? "Starting..." : "Start trip"}</button></>}
          {!position && <p className="hamba-note"><LocateFixed size={16} /> {locationError ?? "Enable location to plan a route."}</p>}
        </section>
      )}
      {message && <p className="hamba-message" role="status">{message}</p>}
    </div>
  );
}