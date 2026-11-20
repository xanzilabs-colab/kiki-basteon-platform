"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AlertTriangle, BusFront, Building2, Check, ChevronRight, Church, Coffee,
  Fuel, Handshake, Hospital, LocateFixed, MapPin, MapPinned, Navigation, RefreshCw, Search,
  Plus, School, ShieldCheck, ShoppingBag, Store, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { BuddyPlaceForm } from "./BuddyPlaceForm";
import { CommunityAlertsPanel } from "./CommunityAlertsPanel";
import "./safeSpots.css";
import { categoryLabel, currentMeetingLocation, directionsUrl, meetingFetch, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";
import type { SafetyMapPoint } from "@/components/KikiSafetyMap";
import { MapBottomSheet, MapScreen } from "@/components/account/MapScreen";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayerOptions";

type BubbleLink = { id: string; member_count: number; expires_at: string };
type Location = { lat: number; lng: number };
type BuddyMapLocation = { id: string; name: string; avatarUrl: string | null; lat: number; lng: number; recordedAt: string };
type MapFilter = "all" | "buddies" | "spots" | "reports";
const KikiSafetyMap = dynamic(() => import("@/components/KikiSafetyMap"), { ssr: false, loading: () => <div className="safe-map-loading" role="status">Loading map…</div> });

const categoryIcons: Record<string, LucideIcon> = {
  petrol_station: Fuel,
  mall: ShoppingBag,
  police_station: ShieldCheck,
  hospital: Hospital,
  cafe_restaurant: Coffee,
  transit_hub: BusFront,
  other_public: MapPinned,
  supermarket: Store,
  school: School,
  place_of_worship: Church,
  bus_stop: BusFront,
  taxi_rank: BusFront,
};

function prettyCategory(value: string) {
  const labels: Record<string, string> = {
    petrol_station: "Petrol station",
    police_station: "Police station",
    cafe_restaurant: "Café or restaurant",
    transit_hub: "Transit hub",
    other_public: "Other public place",
    place_of_worship: "Place of worship",
    taxi_rank: "Taxi rank",
    bus_stop: "Bus stop",
  };
  return labels[value] ?? categoryLabel(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function distanceMeters(from: Location | null, to: Location) {
  if (!from) return null;
  const radians = (value: number) => value * Math.PI / 180;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  const distance = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance < 1000 ? `${Math.max(1, Math.round(distance / 10) * 10)} m` : `${(distance / 1000).toFixed(1)} km`;
}

export function BuddySafePlaces() {
  const [places, setPlaces] = useState<PublicSpot[]>([]);
  const [alerts, setAlerts] = useState<CommunityAlert[]>([]);
  const [bubbles, setBubbles] = useState<BubbleLink[]>([]);
  const [buddyLocations, setBuddyLocations] = useState<BuddyMapLocation[]>([]);
  const [point, setPoint] = useState<Location | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [tab, setTab] = useState<"spots" | "alerts" | "meetings">("alerts");
  const [sheetLevel, setSheetLevel] = useState<0 | 1 | 2>(0);
  const [mapLayerIndex, setMapLayerIndex] = useState(0);
  const [mapRecenter, setMapRecenter] = useState(0);
  const [category, setCategory] = useState("all");
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [buddyLocationsError, setBuddyLocationsError] = useState(false);

  const categories = useMemo(() => [...new Set(places.map((place) => place.category))], [places]);
  const filteredPlaces = useMemo(
    () => places.filter((place) => category === "all" || place.category === category),
    [category, places],
  );
  const activeAlerts = alerts;
  const mapPoints = useMemo<SafetyMapPoint[]>(() => {
    const allPoints: SafetyMapPoint[] = [
    ...buddyLocations.map((buddy) => ({ id: buddy.id, lat: buddy.lat, lng: buddy.lng, kind: "buddy" as const, name: buddy.name, avatarUrl: buddy.avatarUrl })),
    ...filteredPlaces.map((spot) => ({ id: spot.id, lat: spot.lat, lng: spot.lng, kind: "spot" as const, category: spot.category })),
    ...activeAlerts.map((alert) => ({ id: alert.id, lat: alert.lat, lng: alert.lng, kind: "report" as const, category: alert.kind, createdAt: alert.created_at, upvotes: alert.upvotes })),
    ];
    if (mapFilter === "all") return allPoints;
    const kind = { buddies: "buddy", spots: "spot", reports: "report" }[mapFilter];
    return allPoints.filter((mapPoint) => mapPoint.kind === kind);
  }, [activeAlerts, buddyLocations, filteredPlaces, mapFilter]);
  const currentMapLayer = MAP_BASE_LAYERS[mapLayerIndex]?.name as MapBaseLayerName | undefined;
  const topBarCount = tab === "spots"
    ? `${filteredPlaces.length} ${filteredPlaces.length === 1 ? "spot" : "spots"} nearby`
    : tab === "alerts"
      ? `${activeAlerts.length} ${activeAlerts.length === 1 ? "report" : "reports"} nearby`
      : `${bubbles.length} ${bubbles.length === 1 ? "meeting" : "meetings"}`;

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "spots" || requestedTab === "alerts" || requestedTab === "meetings") setTab(requestedTab);
    const controller = new AbortController();
    void meetingFetch<{ bubbles: BubbleLink[] }>("/api/buddies/meetings", undefined, controller.signal)
      .then((data) => setBubbles(data.bubbles))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Bubble meetings could not be loaded.");
          setMessageIsError(true);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    const loadBuddyLocations = async () => {
      try {
        const response = await fetch("/api/account/buddies/locations", { cache: "no-store" });
        if (!response.ok) throw new Error("Buddy locations could not be loaded.");
        const data = await response.json() as { locations?: BuddyMapLocation[] };
        if (active) {
          setBuddyLocations(data.locations ?? []);
          setBuddyLocationsError(false);
        }
      } catch {
        if (active) setBuddyLocationsError(true);
      }
    };
    void loadBuddyLocations();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadBuddyLocations();
    };
    const timer = window.setInterval(refreshVisible, 30_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  // Live feed: a server broadcast pings subscribers, who then refetch authoritative data (also on reconnect and tab focus).
  useEffect(() => {
    if (!searched || !point) return;
    const query = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
    const refresh = () => { void meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`).then((data) => setAlerts(data.alerts)).catch(() => undefined); };
    const supabase = createClient();
    const channel = supabase.channel("community-alerts")
      .on("broadcast", { event: "changed" }, refresh)
      .subscribe((status) => { if (status === "SUBSCRIBED") refresh(); });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [searched, point]);

  async function search() {
    setBusy(true);
    setMessage("");
    try {
      const next = await currentMeetingLocation();
      setPoint(next);
      const query = new URLSearchParams({ lat: String(next.lat), lng: String(next.lng) });
      const [spots, reports] = await Promise.all([
        meetingFetch<{ places: PublicSpot[] }>(`/api/buddies/safe-places?${query}`),
        meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`),
      ]);
      setPlaces(spots.places);
      setAlerts(reports.alerts);
      setCategory("all");
      setSelectedSpot(null);
      setSearched(true);
      setMessageIsError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search unavailable.");
      setMessageIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function suggest(body: object) {
    setBusy(true);
    setMessage("");
    try {
      await meetingFetch("/api/buddies/safe-places", body);
      setMessage("Spot submitted for review.");
      setMessageIsError(false);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest spot.");
      setMessageIsError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function changeMessage(next: string) {
    setMessage(next);
    setMessageIsError(/could not|couldn|can't|unavailable|please|error|failed|closed/i.test(next));
  }

  return <MapScreen
    screenId="safe-spots"
    className="buddy-places buddies-page safe-spots-page"
    map={<KikiSafetyMap center={point} points={mapPoints} zoom={14} layer={currentMapLayer} recenter={mapRecenter} userLocationStyle="dot" onBuddySelect={(userId) => { window.location.href = `/account/profile/buddies/${userId}`; }} />}
    topBar={<div className="safe-spots-map-actions">
      <Link href="/account/profile/buddies" className="safe-map-buddy-circle">
        <span className="safe-map-buddy-avatars" aria-hidden="true">
          {buddyLocations.slice(0, 3).map((buddy) => buddy.avatarUrl
            ? <img key={buddy.id} src={buddy.avatarUrl} alt="" />
            : <i key={buddy.id}>{buddy.name.trim().charAt(0).toUpperCase() || "?"}</i>)}
          {!buddyLocations.length && <UsersRound size={18} />}
        </span>
        <span className="safe-map-buddy-copy"><b>Safe spots &amp; reports</b><small>{buddyLocationsError ? "Buddy locations unavailable" : `${buddyLocations.length} buddies sharing`}</small></span>
      </Link>
      <span className="safe-map-count">{searched ? topBarCount : "Nearby safety"}</span>
      {searched
        ? <button className="safe-map-refresh" type="button" disabled={busy} onClick={() => void search()} aria-label="Refresh nearby places" title="Refresh nearby places"><RefreshCw size={17} className={busy ? "is-spinning" : ""} /></button>
        : <button type="button" className="safe-map-search" disabled={busy} onClick={() => void search()} aria-label={busy ? "Searching nearby" : "Search nearby"} title="Search nearby"><Search size={18} className={busy ? "is-spinning" : ""} /></button>}
    </div>}
    controls={<div className="safe-map-controls" data-map-ui="hide">
      <div className="safe-map-filter-strip" role="group" aria-label="Map layers">
        <button type="button" aria-pressed={mapFilter === "all"} onClick={() => setMapFilter("all")}>All</button>
        <button type="button" aria-pressed={mapFilter === "buddies"} onClick={() => setMapFilter("buddies")}><UsersRound size={14} />Buddies</button>
        <button type="button" aria-pressed={mapFilter === "spots"} onClick={() => setMapFilter("spots")}><ShieldCheck size={14} />Safe Havens</button>
        <button type="button" aria-pressed={mapFilter === "reports"} onClick={() => setMapFilter("reports")}><AlertTriangle size={14} />Reports</button>
      </div>
      {searched && activeAlerts.length > 0 && <div className="safe-risk-legend" role="note">
        <span>Reported risk</span>
        <i aria-hidden="true" />
        <small>Lower reported risk</small><small>Higher reported risk</small>
        <small className="safe-risk-disclaimer">No reports does not confirm an area is safe.</small>
      </div>}
    </div>}
    tools={<button type="button" className="safe-map-compose" onClick={() => window.dispatchEvent(new Event("kiki:open-report-composer"))}><Plus size={16} />Report / Check-in</button>}
    onRecenter={() => point ? setMapRecenter((value) => value + 1) : void search()}
    selectedLayer={currentMapLayer}
    onLayerChange={(layer) => setMapLayerIndex(MAP_BASE_LAYERS.findIndex((item) => item.name === layer))}
    bottomSheet={<MapBottomSheet level={sheetLevel} onLevelChange={setSheetLevel} label="Safe spots and community reports">
    <div className="safe-spots-sheet-body">
      <div className="safe-spots-tabs account-segmented" role="tablist" aria-label="Safe spots and reports">
      <button id="safe-tab-alerts" type="button" role="tab" aria-selected={tab === "alerts"} aria-controls="safe-panel-alerts" onClick={() => setTab("alerts")}><AlertTriangle size={16} />Pulse<span>{activeAlerts.length || ""}</span></button>
      <button id="safe-tab-spots" type="button" role="tab" aria-selected={tab === "spots"} aria-controls="safe-panel-spots" onClick={() => setTab("spots")}><ShieldCheck size={16} />Safe Havens<span>{places.length || ""}</span></button>
      <button id="safe-tab-meetings" type="button" role="tab" aria-selected={tab === "meetings"} aria-controls="safe-panel-meetings" onClick={() => setTab("meetings")}><Handshake size={16} />Walks<span>{bubbles.length || ""}</span></button>
    </div>

    <section id="safe-panel-spots" role="tabpanel" aria-labelledby="safe-tab-spots" hidden={tab !== "spots"} className="safe-spots-tab-panel">
      {places.some((place) => place.is_demo) && <div className="safe-demo-notice" role="note"><b>Demo data — not verified.</b> Sample locations are fictional placeholders, not real venues or safety recommendations. Do not rely on them for directions or personal safety.</div>}

      {searched && categories.length > 0 && <div className="safe-category-chips" aria-label="Filter spots by category">
        <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setSelectedSpot(null); }}>All</button>
        {categories.map((value) => {
          const Icon = categoryIcons[value] ?? Building2;
          return <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setSelectedSpot(null); }}><Icon size={14} />{prettyCategory(value)}</button>;
        })}
      </div>}

      {!searched ? (
        <button className="safe-search-prompt" type="button" disabled={busy} onClick={() => void search()}><Search size={18} /><span><b>{busy ? "Finding places nearby…" : "Search places nearby"}</b></span><LocateFixed size={18} /></button>
      ) : filteredPlaces.length ? (
        <div className="safe-spot-list account-list-card">{filteredPlaces.map((place) => {
          const Icon = categoryIcons[place.category] ?? Building2;
          const distance = distanceMeters(point, place);
          return <article className={`safe-spot-card${place.is_demo ? " is-demo" : ""}${selectedSpot === place.id ? " is-selected" : ""}`} id={`safe-spot-${place.id}`} key={place.id}>
            <button type="button" className="safe-spot-title" onClick={() => setSelectedSpot(selectedSpot === place.id ? null : place.id)} aria-pressed={selectedSpot === place.id}>
              <span className="safe-spot-icon"><Icon size={19} /></span>
              <span className="safe-spot-name"><b>{place.name}</b><small>{prettyCategory(place.category)}{distance ? ` · ${distance}` : ""}</small></span>
              {place.is_demo ? <span className="safe-spot-status is-demo">Sample</span> : <span className="safe-spot-status"><Check size={15} aria-label="Reviewed" /></span>}
              <ChevronRight className="safe-spot-chevron" size={17} aria-hidden="true" />
            </button>
            {selectedSpot === place.id && <div className="safe-spot-details">
              <span>{place.address || "Address not provided"} · {place.open_24h ? "Open 24 hours" : "Hours may vary"}</span>
              {place.is_demo ? <span className="safe-directions-link is-disabled" aria-label="Directions unavailable for demo locations">Sample only</span> : <a className="safe-directions-link" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer" aria-label={`Directions to ${place.name}`}><Navigation size={16} /></a>}
            </div>}
          </article>;
        })}</div>
      ) : <div className="safe-empty-card"><span><MapPin size={21} /></span><b>{places.length ? "No spots in this category" : "No reviewed spots nearby yet"}</b><p>{places.length ? "Choose another category to see more places." : "Try again later, or suggest a public place for review."}</p></div>}
      <details className="safe-suggest-card">
        <summary><span className="safe-suggest-icon"><MapPin size={19} /></span><span><b>Suggest a public place</b><small>We review suggestions before they appear.</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
        <BuddyPlaceForm busy={busy} onSave={suggest} />
      </details>
    </section>

    <section id="safe-panel-alerts" role="tabpanel" aria-labelledby="safe-tab-alerts" hidden={tab !== "alerts"} className="safe-spots-tab-panel">
      <CommunityAlertsPanel alerts={alerts} busy={busy} initialPoint={point} onBusyChange={setBusy} onAlertsChange={setAlerts} onLocationChange={setPoint} onMessage={changeMessage} />
    </section>

    <section id="safe-panel-meetings" role="tabpanel" aria-labelledby="safe-tab-meetings" hidden={tab !== "meetings"} className="safe-spots-tab-panel">
      {bubbles.length > 0 ? <div className="safe-meeting-list account-list-card">{bubbles.map((bubble, index) => <Link className="safe-meeting-card" key={bubble.id} href={`/account/buddies/meeting/${bubble.id}`}>
        <span className="safe-meeting-icon"><UsersRound size={19} /></span>
        <span className="safe-meeting-copy"><b>Bubble {index + 1}</b><small>{bubble.member_count} {bubble.member_count === 1 ? "person" : "people"} · Active meeting</small></span>
        <span className="safe-meeting-open"><span className="safe-meeting-open-copy">Active</span><ChevronRight size={16} /></span>
      </Link>)}</div> : <div className="safe-empty-card"><span><Handshake size={21} /></span><b>No active Bubble meetings</b><p>Create or join a Bubble to choose a meeting spot together.</p><Link href="/account/trips?mode=travel-together">Go to Travel Together<ChevronRight size={15} /></Link></div>}
      {bubbles.length > 0 && <Link className="safe-meeting-create" href="/account/trips?mode=travel-together"><Handshake size={17} />Create or join a Bubble<ChevronRight size={16} /></Link>}
    </section>

    {message && <div className={`safe-spots-message${messageIsError ? " is-error" : ""}`} role={messageIsError ? "alert" : "status"}>{message}</div>}
    </div>
    </MapBottomSheet>}
  />;
}
