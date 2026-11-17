"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AlertTriangle, BusFront, Building2, Check, ChevronRight, Church, Clock3, Coffee,
  Fuel, Handshake, Hospital, LocateFixed, MapPin, MapPinned, Navigation, RefreshCw, Search,
  School, ShieldCheck, ShoppingBag, Store, UsersRound,
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

export function BuddySafePlaces() {
  const [places, setPlaces] = useState<PublicSpot[]>([]);
  const [alerts, setAlerts] = useState<CommunityAlert[]>([]);
  const [bubbles, setBubbles] = useState<BubbleLink[]>([]);
  const [point, setPoint] = useState<Location | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [tab, setTab] = useState<"spots" | "alerts" | "meetings">("spots");
  const [sheetLevel, setSheetLevel] = useState<0 | 1 | 2>(0);
  const [mapLayerIndex, setMapLayerIndex] = useState(0);
  const [mapRecenter, setMapRecenter] = useState(0);
  const [category, setCategory] = useState("all");
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);

  const categories = useMemo(() => [...new Set(places.map((place) => place.category))], [places]);
  const filteredPlaces = useMemo(
    () => places.filter((place) => category === "all" || place.category === category),
    [category, places],
  );
  const activeAlerts = alerts;
  const mapPoints = useMemo<SafetyMapPoint[]>(() => [
    ...filteredPlaces.map((spot) => ({ id: spot.id, lat: spot.lat, lng: spot.lng, kind: "spot" as const, category: spot.category })),
    ...activeAlerts.map((alert) => ({ id: alert.id, lat: alert.lat, lng: alert.lng, kind: "report" as const, category: alert.kind, createdAt: alert.created_at, upvotes: alert.upvotes })),
  ], [activeAlerts, filteredPlaces]);
  const currentMapLayer = MAP_BASE_LAYERS[mapLayerIndex]?.name as MapBaseLayerName | undefined;

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
    map={<KikiSafetyMap center={point} points={mapPoints} zoom={14} layer={currentMapLayer} recenter={mapRecenter} />}
    topBar={<div className="safe-spots-map-actions">
      <span>{searched
        ? tab === "spots" ? `${filteredPlaces.length} spots nearby`
          : tab === "alerts" ? `${activeAlerts.length} reports nearby`
            : `${bubbles.length} meetings`
        : "Nearby map"}</span>
      {searched
        ? <button className="safe-map-refresh" type="button" disabled={busy} onClick={() => void search()} aria-label="Refresh nearby places" title="Refresh nearby places"><RefreshCw size={17} className={busy ? "is-spinning" : ""} /></button>
        : <button type="button" className="safe-map-search" disabled={busy} onClick={() => void search()} aria-label={busy ? "Searching nearby" : "Search nearby"} title="Search nearby"><Search size={18} className={busy ? "is-spinning" : ""} /></button>}
    </div>}
    controls={searched && activeAlerts.length > 0 ? <div className="safe-risk-legend" role="note" data-map-ui="hide">
      <span>Reported risk</span>
      <i aria-hidden="true" />
      <small>Lower reported risk</small><small>Higher reported risk</small>
      <small className="safe-risk-disclaimer">No reports does not confirm an area is safe.</small>
    </div> : undefined}
    onRecenter={() => point ? setMapRecenter((value) => value + 1) : void search()}
    selectedLayer={currentMapLayer}
    onLayerChange={(layer) => setMapLayerIndex(MAP_BASE_LAYERS.findIndex((item) => item.name === layer))}
    bottomSheet={<MapBottomSheet level={sheetLevel} onLevelChange={setSheetLevel} label="Safe spots and community reports">
    <div className="safe-spots-sheet-body">
      <div className="safe-spots-tabs account-segmented" role="tablist" aria-label="Safe spots and reports">
      <button id="safe-tab-spots" type="button" role="tab" aria-selected={tab === "spots"} aria-controls="safe-panel-spots" onClick={() => setTab("spots")}><MapPin size={16} />Spots<span>{places.length}</span></button>
      <button id="safe-tab-alerts" type="button" role="tab" aria-selected={tab === "alerts"} aria-controls="safe-panel-alerts" onClick={() => setTab("alerts")}><AlertTriangle size={16} />Reports<span>{activeAlerts.length}</span></button>
      <button id="safe-tab-meetings" type="button" role="tab" aria-selected={tab === "meetings"} aria-controls="safe-panel-meetings" onClick={() => setTab("meetings")}><Handshake size={16} />Meetings<span>{bubbles.length}</span></button>
    </div>

    <section id="safe-panel-spots" role="tabpanel" aria-labelledby="safe-tab-spots" hidden={tab !== "spots"} className="safe-spots-tab-panel">
      {places.some((place) => place.is_demo) && <div className="safe-demo-notice" role="note"><b>Demo data — not verified.</b> Sample locations are fictional placeholders, not real venues or safety recommendations. Do not rely on them for directions or personal safety.</div>}

      {searched && categories.length > 0 && <div className="safe-category-chips" aria-label="Filter spots by category">
        <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setSelectedSpot(null); }}>All <span>{places.length}</span></button>
        {categories.map((value) => {
          const Icon = categoryIcons[value] ?? Building2;
          const count = places.filter((place) => place.category === value).length;
          return <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setSelectedSpot(null); }}><Icon size={14} />{prettyCategory(value)}<span>{count}</span></button>;
        })}
      </div>}

      <div className="safe-spots-list-heading"><div><h2>Nearby spots</h2><p>{searched ? places.some((place) => place.is_demo) ? "Reviewed spots and clearly labeled demo samples" : "Public places reviewed for your area" : "Places where you can meet or ask for help"}</p></div><span>{searched ? filteredPlaces.length : "—"}</span></div>
      {!searched ? (
        <button className="safe-search-prompt" type="button" disabled={busy} onClick={() => void search()}><LocateFixed size={19} /><span><b>Search nearby</b><small>Find reviewed public places around your current location.</small></span><ChevronRight size={18} /></button>
      ) : filteredPlaces.length ? (
        <div className="safe-spot-list account-list-card">{filteredPlaces.map((place) => {
          const Icon = categoryIcons[place.category] ?? Building2;
          return <article className={`safe-spot-card${place.is_demo ? " is-demo" : ""}${selectedSpot === place.id ? " is-selected" : ""}`} id={`safe-spot-${place.id}`} key={place.id}>
            <button type="button" className="safe-spot-title" onClick={() => setSelectedSpot(selectedSpot === place.id ? null : place.id)} aria-pressed={selectedSpot === place.id}>
              <span className="safe-spot-icon"><Icon size={19} /></span>
              <span className="safe-spot-name"><b>{place.name}</b><small>{prettyCategory(place.category)}</small></span>
              <ChevronRight size={17} />
            </button>
            <p className="safe-spot-address">{place.address || "Address not provided"}</p>
            <div className="safe-spot-footer">
              <span className={`safe-reviewed-badge${place.is_demo ? " is-demo" : ""}`}>{place.is_demo ? <><AlertTriangle size={14} />Demo sample · unverified</> : <><ShieldCheck size={14} />Reviewed spot</>}</span>
              <span className="safe-hours-badge"><Clock3 size={13} />{place.open_24h ? "Open 24 hours" : "Hours may vary"}</span>
              {place.is_demo ? <span className="safe-directions-link is-disabled" aria-label="Directions unavailable for demo locations">Sample only</span> : <a className="safe-directions-link" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a>}
            </div>
          </article>;
        })}</div>
      ) : <div className="safe-empty-card"><span><MapPin size={21} /></span><b>{places.length ? "No spots in this category" : "No reviewed spots nearby yet"}</b><p>{places.length ? "Choose another category to see more places." : "Try again later, or suggest a public place for review."}</p></div>}
      <section className="safe-suggest-card">
        <span className="safe-suggest-icon"><MapPin size={19} /></span>
        <div><h3>Know a public place?</h3><p>Suggest it for review so it can help people nearby.</p></div>
        <details><summary>Suggest a spot</summary><BuddyPlaceForm busy={busy} onSave={suggest} /></details>
      </section>
    </section>

    <section id="safe-panel-alerts" role="tabpanel" aria-labelledby="safe-tab-alerts" hidden={tab !== "alerts"} className="safe-spots-tab-panel">
      <CommunityAlertsPanel alerts={alerts} busy={busy} initialPoint={point} onBusyChange={setBusy} onAlertsChange={setAlerts} onLocationChange={setPoint} onMessage={changeMessage} />
    </section>

    <section id="safe-panel-meetings" role="tabpanel" aria-labelledby="safe-tab-meetings" hidden={tab !== "meetings"} className="safe-spots-tab-panel">
      <div className="safe-meetings-heading"><span><Handshake size={20} /></span><div><h2>Your Bubble meetings</h2><p>Open a meeting to help your group choose a safe place together.</p></div></div>
      {bubbles.length > 0 ? <div className="safe-meeting-list account-list-card">{bubbles.map((bubble, index) => <Link className="safe-meeting-card" key={bubble.id} href={`/account/buddies/meeting/${bubble.id}`}>
        <span className="safe-meeting-icon"><UsersRound size={19} /></span>
        <span className="safe-meeting-copy"><b>Bubble {index + 1}</b><small>{bubble.member_count} {bubble.member_count === 1 ? "Buddy" : "Buddies"} · Active meeting</small></span>
        <span className="safe-meeting-open"><span className="safe-meeting-open-copy">Open meeting</span><ChevronRight size={16} /></span>
      </Link>)}</div> : <div className="safe-empty-card"><span><Handshake size={21} /></span><b>No active Bubble meetings</b><p>Create or join a Bubble to choose a meeting spot together.</p><Link href="/account/trips?mode=travel-together">Go to Travel Together<ChevronRight size={15} /></Link></div>}
      <Link className="safe-meeting-create" href="/account/trips?mode=travel-together"><Handshake size={17} />Create or join a Bubble<ChevronRight size={16} /></Link>
      <section className="safe-meeting-note"><span><Check size={16} /></span><p>Meeting locations are shared with your Bubble members so everyone can make their way to the same public place.</p></section>
    </section>

    {message && <div className={`safe-spots-message${messageIsError ? " is-error" : ""}`} role={messageIsError ? "alert" : "status"}>{message}</div>}
    </div>
    </MapBottomSheet>}
  />;
}
