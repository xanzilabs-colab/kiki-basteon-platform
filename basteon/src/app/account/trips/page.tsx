"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bike, Bus, Car, CheckCircle2, ChevronRight, Clock3, Expand, Flag, Footprints, History, LocateFixed, MapPinned, Navigation, ShieldCheck, Timer, TrainFront, UsersRound, Wind, X } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { formatDistance } from "@/lib/geo";
import { remainingRouteDurationS } from "@/lib/hamba/geometry";
import { buildManualRoute, checkpointTimes, mergeBySeq, thin, type TripTools } from "@/lib/hamba/manualRoute";
import type { TripMode } from "@/lib/hamba/types";
import { evaluateRouteWatch } from "@/lib/hamba/routeWatch";
import type { GeoPoint, RouteWatchState } from "@/lib/hamba/types";
import { enablePushNotifications } from "@/lib/usePushNotifications";
import { TravelTogetherPanel } from "@/components/TravelTogetherPanel";
import { useAppDialog } from "@/components/AppDialogProvider";

const TripMap = dynamic(() => import("@/components/TripMap"), { ssr: false, loading: () => <div className="hamba-map hamba-map-loading">Loading map...</div> });
type Place = { label: string; lat: number; lng: number };
type RouteOrigin = { lat: number; lng: number };
type CheckpointView = { id: string; lat: number; lng: number; label: string | null; expected_at: string | null; status: string };
type Route = { points: Place[]; distanceM: number; durationS: number };
type ActiveTrip = { id: string; destination_label: string; destination_lat: number; destination_lng: number; mode: TripMode; planned_route: Route; route_distance_m: number; route_duration_s: number; started_at: string; expected_arrival_at: string; next_check_in_at: string | null; status: string };
type RecentTrip = { id: string; destination_label: string; destination_lat: number; destination_lng: number; mode: TripMode; status: string; created_at: string; ended_at: string | null };
type Buddy = { id: string; kikiId: string; name: string; avatarUrl: string | null };
type TripGuardian = { id: string; guardianId: string; status: "pending" | "accepted" | "declined" | "revoked"; buddy: Buddy | null; createdAt: string; respondedAt: string | null };
const transitModes = [
  { value: "taxi", label: "Taxi", icon: Bus },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "ehail", label: "E-hail", icon: Car },
  { value: "bus", label: "Bus", icon: Bus },
  { value: "train", label: "Train", icon: TrainFront },
  { value: "cycling", label: "Cycling", icon: Bike },
] as const;
const modeLabels: Record<TripMode, string> = { taxi: "Taxi", walk: "Walk", ehail: "E-hail", bus: "Bus", train: "Train", cycling: "Cycling" };

export default function TripsPage() {
  const { position, error: locationError, refreshing: refreshingLocation, refreshLocation } = useGeolocation();
  const { confirm } = useAppDialog();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [destination, setDestination] = useState<Place | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin | null>(null);
  const [mode, setMode] = useState<TripMode>("taxi");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [recenter, setRecenter] = useState(0);
  const [tools, setTools] = useState<TripTools>({ auto: true, stops: false, draw: false });
  const [stops, setStops] = useState<{ lat: number; lng: number; n?: number }[]>([]);
  const [drawn, setDrawn] = useState<{ lat: number; lng: number; n?: number }[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [estimated, setEstimated] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const [buddyContacts, setBuddyContacts] = useState<Buddy[]>([]);
  const [tripGuardians, setTripGuardians] = useState<TripGuardian[]>([]);
  const [selectedGuardianIds, setSelectedGuardianIds] = useState<string[]>([]);
  const [guardianBusy, setGuardianBusy] = useState(false);
  const [guardianMessage, setGuardianMessage] = useState("");
  const nextStop = checkpoints.find((cp) => cp.status !== "checked_in" && cp.status !== "skipped" && cp.status !== "escalated") ?? null;
  const [tripTab, setTripTab] = useState<"route" | "travel">("route");
  const [mapExpanded, setMapExpanded] = useState(false);
  const fixes = useRef<GeoPoint[]>([]);
  const previousWatchState = useRef<RouteWatchState>("normal");

  const loadTripGuardians = useCallback(async (tripId: string) => {
    try {
      const [buddiesResponse, guardiansResponse] = await Promise.all([
        fetch("/api/account/buddies", { cache: "no-store" }),
        fetch(`/api/trips/${tripId}/guardians`, { cache: "no-store" }),
      ]);
      const [buddiesData, guardiansData] = await Promise.all([
        buddiesResponse.json().catch(() => ({})),
        guardiansResponse.json().catch(() => ({})),
      ]);
      if (!buddiesResponse.ok || !guardiansResponse.ok) {
        setGuardianMessage("Buddy sharing settings could not be loaded. Please refresh.");
        return;
      }
      setBuddyContacts(Array.isArray(buddiesData.buddies) ? buddiesData.buddies : []);
      setTripGuardians(Array.isArray(guardiansData.guardians) ? guardiansData.guardians : []);
      setGuardianMessage("");
    } catch {
      setGuardianMessage("Buddy sharing settings could not be loaded. Check your connection.");
    }
  }, []);

  useEffect(() => {
    fetch("/api/trips").then((response) => response.json()).then((data) => {
      setActiveTrip(data.trip ?? null);
      setCheckpoints(data.checkpoints ?? []);
      const recent = (data.recent ?? []) as RecentTrip[];
      setRecentTrips(recent);
      const selectedId = new URLSearchParams(window.location.search).get("destination");
      const selected = recent.find((trip) => trip.id === selectedId);
      if (selected) {
        setDestination({ label: selected.destination_label, lat: selected.destination_lat, lng: selected.destination_lng });
        setQuery(selected.destination_label);
        setMode(selected.mode);
        setTripTab("route");
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeTrip) {
      setTripGuardians([]);
      setSelectedGuardianIds([]);
      return;
    }
    void loadTripGuardians(activeTrip.id);
  }, [activeTrip?.id, loadTripGuardians]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "travel-together") setTripTab("travel");
  }, []);

  useEffect(() => {
    if (!mapExpanded) return;
    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mapExpanded]);

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
    if (!routeOrigin) {
      setRouteOrigin({ lat: position.lat, lng: position.lng });
      return;
    }
  }, [destination, position, routeOrigin]);

  useEffect(() => {
    if (!destination || !routeOrigin) return;
    setMessage("");
    if (!tools.auto) {
      setRoutes([buildManualRoute(routeOrigin, destination, mode, stops, drawn) as unknown as Route]);
      setSelectedRoute(0);
      setEstimated(true);
      return;
    }
    const waypoints = mergeBySeq(stops.slice(0, 5), thin(drawn, 5)).map(({ lat, lng }) => ({ lat, lng }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: routeOrigin, destination, mode, waypoints }), signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => { setRoutes(data.routes); setSelectedRoute(0); setEstimated(Boolean(data.estimated)); })
        .catch(() => { if (!controller.signal.aborted) setMessage("Route planning is unavailable. Try again when you have data coverage."); });
    }, drawn.length ? 500 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [destination, mode, routeOrigin?.lat, routeOrigin?.lng, tools.auto, stops, drawn]);

  useEffect(() => {
    void fetch("/api/account/profile/avatar").then((response) => response.ok ? response.json() : null).then((data) => setAvatarUrl(data?.url ?? null)).catch(() => undefined);
  }, []);

  const seq = useRef(0);
  const addDrawPoint = useCallback((point: { lat: number; lng: number }) => {
    setDrawn((current) => current.length < 300 ? [...current, { ...point, n: ++seq.current }] : current);
  }, []);
  function addMapPoint(point: { lat: number; lng: number }) {
    if (tools.stops) setStops((current) => current.length < 6 ? [...current, { ...point, n: ++seq.current }] : current);
  }

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
      const checkpoints = stops.map((stop, i) => ({ ...stop, label: `Stop ${i + 1}`, expectedAt: new Date(checkpointTimes(route, stops, Date.now())[i]).toISOString() }));
      const response = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationLabel: destination.label, destination, mode, route, checkpoints, tools: Object.entries(tools).filter(([, on]) => on).map(([name]) => name) }) });
      const data = await response.json();
      if (!response.ok) return setMessage(typeof data.error === "string" ? data.error : "Could not start your trip.");
      localStorage.setItem("hamba-active-route", JSON.stringify(route));
      fixes.current = [];
      previousWatchState.current = "normal";
      setNow(Date.now());
      setMessage("");
      setActiveTrip(data.trip);
      setCheckpoints(data.checkpoints ?? []);
    } catch { setMessage("Could not start your trip. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function checkIn(checkpointId?: string) {
    if (!activeTrip) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/check-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checkpointId ? { checkpointId } : {}) });
      if (!response.ok) return setMessage("Check-in could not be recorded. Please try again.");
      setMessage("Check-in recorded. Route Watch is still monitoring your trip.");
      const refreshed = await fetch("/api/trips");
      if (refreshed.ok) { const data = await refreshed.json(); setActiveTrip(data.trip ?? null); setCheckpoints(data.checkpoints ?? []); }
    } catch { setMessage("Check-in could not be confirmed. Check your connection."); }
    finally { setBusy(false); }
  }

  async function arrive() {
    if (!activeTrip) return;
    if (!(await confirm("Confirm that you have arrived safely.", {
      title: "End your trip?",
      confirmLabel: "I arrived safely",
    }))) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/arrive`, { method: "POST" });
      if (!response.ok) return setMessage("Arrival could not be confirmed. Your trip remains active.");
      setRecentTrips((current) => [{ ...activeTrip, created_at: activeTrip.started_at, ended_at: new Date().toISOString(), status: "arrived" }, ...current].slice(0, 5));
      localStorage.removeItem("hamba-active-route"); setActiveTrip(null); setCheckpoints([]); setStops([]); setDrawn([]); setDestination(null); setRoutes([]); setQuery(""); setMessage("Trip ended. Glad you arrived safely.");
    } catch { setMessage("Arrival could not be confirmed. Your trip remains active."); }
    finally { setBusy(false); }
  }

  async function inviteGuardians() {
    if (!activeTrip || selectedGuardianIds.length === 0 || guardianBusy) return;
    setGuardianBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/guardians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guardianIds: selectedGuardianIds }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGuardianMessage(data.error === "guardian_must_be_an_unblocked_buddy"
          ? "Only buddies who are still connected and unblocked can be invited."
          : "The walk guardian invitation could not be sent.");
        return;
      }
      const sentCount = Array.isArray(data.pending) ? data.pending.length : 0;
      setGuardianMessage(sentCount
        ? `${sentCount} invitation${sentCount === 1 ? "" : "s"} sent. Your location stays private until each buddy accepts.`
        : "Those buddies already have an invitation or accepted access.");
      setSelectedGuardianIds([]);
      await loadTripGuardians(activeTrip.id);
    } catch {
      setGuardianMessage("The walk guardian invitation could not be sent. Check your connection.");
    } finally {
      setGuardianBusy(false);
    }
  }

  async function revokeGuardian(guardianId: string) {
    if (!activeTrip || guardianBusy) return;
    setGuardianBusy(true);
    try {
      const response = await fetch(`/api/trips/${activeTrip.id}/guardians`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guardianId }),
      });
      if (!response.ok) {
        setGuardianMessage("This buddy's access could not be revoked. Please try again.");
        return;
      }
      setGuardianMessage("Location sharing with this buddy has stopped.");
      await loadTripGuardians(activeTrip.id);
    } catch {
      setGuardianMessage("This buddy's access could not be revoked. Check your connection.");
    } finally {
      setGuardianBusy(false);
    }
  }

  const checkInSeconds = activeTrip?.next_check_in_at ? Math.max(0, Math.ceil((new Date(activeTrip.next_check_in_at).getTime() - now) / 1_000)) : null;
  const countdown = checkInSeconds === null ? "Not scheduled" : `${String(Math.floor(checkInSeconds / 60)).padStart(2, "0")}:${String(checkInSeconds % 60).padStart(2, "0")}`;
  const destinations = recentTrips.filter((trip, index, items) => items.findIndex((item) => item.destination_label === trip.destination_label) === index);

  return (
    <div className="hamba-page">
      <div className="hamba-heading">
        <div><h1 className="page-title">{activeTrip && tripTab === "route" ? "Active trip tracking" : "Where to?"}</h1></div>
        {tripTab === "route" && <span className={activeTrip ? "hamba-live" : "hamba-engine"}>{activeTrip ? <><i />{activeTrip.status === "active" ? "Trip active" : activeTrip.status}</> : "No active trip"}</span>}
      </div>
      <div className="hamba-trip-tabs" role="tablist" aria-label="Trip safety mode">
        <button type="button" role="tab" aria-selected={tripTab === "route"} onClick={() => setTripTab("route")}><Navigation size={16} />Route Watch</button>
        <button type="button" role="tab" aria-selected={tripTab === "travel"} onClick={() => setTripTab("travel")}><UsersRound size={16} />Travel Together</button>
      </div>
      <Link href="/account/calm/winds?mode=quiet" className="my-3 flex min-h-12 items-center gap-3 rounded-2xl border border-[#e3d8eb] bg-white px-4 py-3 text-[#522868] shadow-sm">
        <Wind size={19} /><span><b className="block">Need a minute?</b><small className="text-[#756583]">Open Gentle Winds in Quiet mode</small></span><ChevronRight size={17} className="ml-auto" />
      </Link>
      {tripTab === "route" ? <>
      {activeTrip ? (
        <section className="hamba-active">
          <div className="hamba-map-stage">
            <TripMap points={activeTrip.planned_route.points} position={position} recenter={recenter} avatarUrl={avatarUrl} stops={checkpoints.map((cp) => ({ lat: cp.lat, lng: cp.lng }))} />
            <button type="button" className="hamba-map-expand-button" aria-label="Expand trip map" title="Expand map" onClick={() => setMapExpanded(true)}><Expand size={18} /></button>
            <div className="hamba-map-overlay"><span className="hamba-overlay-icon"><ShieldCheck size={18} /></span><div><h2>{activeTrip.destination_label}</h2><p>{modeLabels[activeTrip.mode]} · {activeRemainingMinutes ?? Math.max(1, Math.ceil((new Date(activeTrip.expected_arrival_at).getTime() - now) / 60_000))} min estimated</p></div><button type="button" className="hamba-recenter" title="Center map on route" aria-label="Center map on route" onClick={() => setRecenter((current) => current + 1)}><LocateFixed size={18} /></button></div>
          </div>
          <div className="hamba-active-card">
            <div className="hamba-control-stats"><div><span>Next check-in</span><b><Timer size={20} />{countdown}</b></div><div><span>Planned distance</span><b>{formatDistance(activeTrip.route_distance_m / 1000)}</b></div></div>
            {nextStop && <div className="hamba-stop-card"><div><span>Next stop</span><b>{nextStop.label ?? "Stop"}{nextStop.expected_at ? ` · ${new Date(nextStop.expected_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</b>{nextStop.status === "missed" && <small>We haven't heard from you. Tap to confirm you're OK.</small>}</div><button className="btn" disabled={busy} onClick={() => void checkIn(nextStop.id)}><CheckCircle2 size={16} />I'm here</button></div>}
            <div className="hamba-actions"><button className="btn" disabled={busy} onClick={() => void checkIn()}><CheckCircle2 size={16} />Check in now</button><button className="btn hamba-arrive" disabled={busy} onClick={() => void arrive()}><Flag size={16} />I've arrived</button></div>
            <section className="mt-5 rounded-2xl border border-[#e8deed] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="flex items-center gap-2 font-semibold"><UsersRound size={18} />Share this active walk</h2><p className="mt-1 text-sm text-[#756583]">Invite a saved buddy as a guardian. They see your live route only after accepting, and access ends when this trip ends or you revoke it.</p></div>
                <Link href="/account/guardian-walks" className="btn">Shared walks</Link>
              </div>
              {tripGuardians.length > 0 && <div className="mt-4 grid gap-2">
                {tripGuardians.map((guardian) => <div key={guardian.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f8f5fa] px-3 py-2">
                  <span><b>{guardian.buddy?.name ?? "Buddy"}</b><small className="ml-2 text-[#756583]">{guardian.status === "accepted" ? "Live location shared" : guardian.status === "pending" ? "Waiting for acceptance" : guardian.status}</small></span>
                  {(guardian.status === "accepted" || guardian.status === "pending") && <button type="button" className="btn" disabled={guardianBusy} onClick={() => void revokeGuardian(guardian.guardianId)}>Stop sharing</button>}
                </div>)}
              </div>}
              {buddyContacts.filter((buddy) => !tripGuardians.some((guardian) => guardian.guardianId === buddy.id && (guardian.status === "pending" || guardian.status === "accepted"))).length > 0 ? <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Invite from your buddy list</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {buddyContacts.filter((buddy) => !tripGuardians.some((guardian) => guardian.guardianId === buddy.id && (guardian.status === "pending" || guardian.status === "accepted"))).map((buddy) => <label key={buddy.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#e8deed] px-3 py-2">
                    <input type="checkbox" checked={selectedGuardianIds.includes(buddy.id)} onChange={(event) => setSelectedGuardianIds((current) => event.target.checked ? [...current, buddy.id] : current.filter((id) => id !== buddy.id))} />
                    <span><b>{buddy.name}</b><small className="ml-2 text-[#756583]">{buddy.kikiId}</small></span>
                  </label>)}
                </div>
                <button type="button" className="btn btn-primary mt-3" disabled={guardianBusy || selectedGuardianIds.length === 0} onClick={() => void inviteGuardians()}><UsersRound size={16} />{guardianBusy ? "Please wait..." : "Send guardian invite"}</button>
              </div> : buddyContacts.length === 0 && <p className="mt-3 text-sm text-[#756583]">Add buddies in your <Link href="/account/profile/buddies" className="underline">buddy list</Link> to invite them here.</p>}
              {guardianMessage && <p className="mt-3 text-sm" role="status">{guardianMessage}</p>}
            </section>
            {!position && <div className="hamba-note" role="status">
              <LocateFixed size={16} /><span>{locationError ?? "Allow location for this site to plan your route."}</span>
              <button className="btn" type="button" disabled={refreshingLocation} onClick={() => void refreshLocation()}>
                {refreshingLocation ? "Checking…" : "Retry location"}
              </button>
            </div>}
          </div>
        </section>
      ) : (
        <section className="hamba-planner">
          <label className="hamba-field-label" htmlFor="trip-destination">Where are you going?</label>
          <div className="hamba-search"><MapPinned size={19} /><input id="trip-destination" value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); setRouteOrigin(null); setRoutes([]); }} placeholder="Type destination address..." autoComplete="off" /></div>
          {places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} onClick={() => { setDestination(place); setRouteOrigin(position ? { lat: position.lat, lng: position.lng } : null); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}
          <span className="hamba-field-label">Travel mode</span>
          <div className="hamba-mode" role="group" aria-label="Travel mode">{transitModes.map((item) => <button key={item.value} type="button" className={mode === item.value ? "active" : ""} aria-pressed={mode === item.value} onClick={() => { if (item.value !== mode) { setRoutes([]); setMode(item.value); } }}><item.icon size={18} /><span>{item.label}</span></button>)}</div>
          <div className="hamba-safety-options"><div><Clock3 size={18} /><div><span>Check-in frequency</span><b>Adaptive · up to 15 min</b></div></div><Link href="/account/guardians"><UsersRound size={18} /><div><span>Guardian Circle</span><b>Manage contacts</b></div><ChevronRight size={14} /></Link></div>
          {destination && <><div className="hamba-tools" role="group" aria-label="Route tools">
            <button type="button" className={tools.auto ? "active" : ""} aria-pressed={tools.auto} onClick={() => setTools((t) => ({ ...t, auto: !t.auto }))}>Auto-route</button>
            <button type="button" className={tools.stops ? "active" : ""} aria-pressed={tools.stops} onClick={() => setTools((t) => ({ ...t, stops: !t.stops, draw: t.stops ? t.draw : false }))}>Add stops{stops.length ? ` (${stops.length})` : ""}</button>
            <button type="button" className={tools.draw ? "active" : ""} aria-pressed={tools.draw} onClick={() => setTools((t) => ({ ...t, draw: !t.draw, stops: t.draw ? t.stops : false }))}>Draw route</button>
            {(stops.length > 0 || drawn.length > 0) && <button type="button" onClick={() => { setStops([]); setDrawn([]); }}>Clear</button>}
          </div>
          {(tools.stops || tools.draw) && <p className="hamba-note">{tools.draw ? "Press and drag on the map to draw your route." : "Tap the map to add a stop. Stops become check-in points."}</p>}
          {!tools.auto && <p className="hamba-note">Auto-route is off, so the route follows your stops and drawing. The time is an estimate.</p>}
          {tools.auto && estimated && <p className="hamba-note">Routing service unavailable for this mode, so this is a straight-line estimate.</p>}
          <div className="hamba-preview">
            <TripMap points={route?.points ?? []} position={position} stops={stops} drawn={drawn} avatarUrl={avatarUrl} onMapClick={addMapPoint} drawing={tools.draw} onDraw={addDrawPoint} />
            <button type="button" className="hamba-map-expand-button" aria-label="Expand trip map" title="Expand map" onClick={() => setMapExpanded(true)}><Expand size={18} /></button>
          </div>
          </>}
          {destination && <><div className="hamba-route-summary"><div><b>{route ? formatDistance(route.distanceM / 1000) : "-"}</b><span>Planned distance</span></div><div><b>{etaMinutes ?? "-"} min</b><span>Estimated time</span></div></div>{routes.length > 1 && <label className="hamba-field-label">Route option<select className="input" value={selectedRoute} onChange={(event) => setSelectedRoute(Number(event.target.value))}>{routes.map((option, index) => <option key={index} value={index}>Route {index + 1} · {formatDistance(option.distanceM / 1000)} · {Math.ceil(option.durationS / 60)} min</option>)}</select></label>}</>}
          <button className="btn btn-primary hamba-start" disabled={!destination || !position || !route || busy} onClick={() => void startTrip()}><Navigation size={17} />{busy ? "Starting..." : "Start active trip protection"}</button>
          {!position && <div className="hamba-note" role="status">
            <LocateFixed size={16} /><span>{locationError ?? "Allow location for this site to plan a route."}</span>
            <button className="btn" type="button" disabled={refreshingLocation} onClick={() => void refreshLocation()}>
              {refreshingLocation ? "Checking…" : "Retry location"}
            </button>
          </div>}
        </section>
      )}
      {!activeTrip && <section className="hamba-recent"><div className="hamba-recent-head"><h2><History size={18} />Recent destinations</h2></div>{destinations.map((trip) => <button type="button" className="hamba-recent-item" key={trip.id} onClick={() => { setDestination({ label: trip.destination_label, lat: trip.destination_lat, lng: trip.destination_lng }); setRouteOrigin(position ? { lat: position.lat, lng: position.lng } : null); setQuery(trip.destination_label); setMode(trip.mode); setRoutes([]); setPlaces([]); }}><span className="hamba-recent-dot" /><div><b>{trip.destination_label}</b><p>{trip.mode} · {trip.status === "arrived" ? "Arrived safely" : "Cancelled"}</p></div><ChevronRight size={17} /></button>)}{destinations.length === 0 && <p className="hamba-empty">Your completed trips will appear here.</p>}</section>}
      {message && <p className="hamba-message" role="status">{message}</p>}
      </> : <TravelTogetherPanel
        position={position}
        locationError={locationError}
        refreshingLocation={refreshingLocation}
        refreshLocation={refreshLocation}
      />}
      {mapExpanded && typeof document !== "undefined" && createPortal(
        <div className="hamba-map-expand-modal" role="dialog" aria-modal="true" aria-labelledby="hamba-map-expand-title">
          <header><h2 id="hamba-map-expand-title">Adjust your map</h2><button type="button" aria-label="Close expanded map" onClick={() => setMapExpanded(false)}><X size={20} /></button></header>
          <div className="hamba-map-expand-canvas">
            <TripMap
              points={activeTrip ? activeTrip.planned_route.points : (route?.points ?? [])}
              position={position}
              recenter={recenter}
              stops={activeTrip ? checkpoints.map((cp) => ({ lat: cp.lat, lng: cp.lng })) : stops}
              drawn={activeTrip ? [] : drawn}
              avatarUrl={avatarUrl}
              onMapClick={activeTrip ? undefined : addMapPoint}
              drawing={!activeTrip && tools.draw}
              onDraw={activeTrip ? undefined : addDrawPoint}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}