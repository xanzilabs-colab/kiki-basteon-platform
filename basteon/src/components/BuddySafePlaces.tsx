"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BusFront, Building2, Check, ChevronRight, Church, Clock3, Coffee,
  Fuel, Handshake, Hospital, LocateFixed, MapPin, MapPinned, Navigation, RefreshCw,
  School, ShieldCheck, ShoppingBag, Store, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { BuddyPlaceForm } from "./BuddyPlaceForm";
import { CommunityAlertsPanel } from "./CommunityAlertsPanel";
import "./safeSpots.css";
import { categoryLabel, currentMeetingLocation, directionsUrl, meetingFetch, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";

type BubbleLink = { id: string; member_count: number; expires_at: string };
type Location = { lat: number; lng: number };

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

function mapPosition(spot: PublicSpot, places: PublicSpot[], point: Location | null) {
  const coordinates = [...places, ...(point ? [{ lat: point.lat, lng: point.lng }] : [])];
  const latitudes = coordinates.map(({ lat }) => lat);
  const longitudes = coordinates.map(({ lng }) => lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = Math.max(maxLat - minLat, 0.003);
  const lngSpan = Math.max(maxLng - minLng, 0.003);

  return {
    left: `${12 + ((spot.lng - minLng) / lngSpan) * 76}%`,
    top: `${14 + ((maxLat - spot.lat) / latSpan) * 70}%`,
  };
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
  const [category, setCategory] = useState("all");
  const [selectedSpot, setSelectedSpot] = useState<string | null>(null);

  const categories = useMemo(() => [...new Set(places.map((place) => place.category))], [places]);
  const filteredPlaces = useMemo(
    () => places.filter((place) => category === "all" || place.category === category),
    [category, places],
  );
  const activeAlerts = alerts.filter((alert) => Date.parse(alert.expires_at) > Date.now());

  useEffect(() => {
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

  return <div className="buddy-places buddies-page safe-spots-page">
    <div className="safe-spots-heading">
      <div>
        <p className="safe-spots-eyebrow">Community safety</p>
        <h1>Safe spots<br />and reports</h1>
      </div>
    </div>

    <div className="safe-spots-tabs" role="tablist" aria-label="Safe spots and reports">
      <span className={`safe-spots-tab-thumb ${tab}`} aria-hidden="true" />
      <button id="safe-tab-spots" type="button" role="tab" aria-selected={tab === "spots"} aria-controls="safe-panel-spots" onClick={() => setTab("spots")}><MapPin size={16} />Spots<span>{places.length}</span></button>
      <button id="safe-tab-alerts" type="button" role="tab" aria-selected={tab === "alerts"} aria-controls="safe-panel-alerts" onClick={() => setTab("alerts")}><AlertTriangle size={16} />Report<span>{activeAlerts.length}</span></button>
      <button id="safe-tab-meetings" type="button" role="tab" aria-selected={tab === "meetings"} aria-controls="safe-panel-meetings" onClick={() => setTab("meetings")}><Handshake size={16} />Meetings<span>{bubbles.length}</span></button>
    </div>

    <section id="safe-panel-spots" role="tabpanel" aria-labelledby="safe-tab-spots" hidden={tab !== "spots"} className="safe-spots-tab-panel">
      <section className="safe-map-card">
        <div className="safe-map-topline">
          <span><MapPinned size={17} />{searched ? `${filteredPlaces.length} ${filteredPlaces.length === 1 ? "spot" : "spots"} nearby` : "Find a safe spot near you"}</span>
          <button className="safe-map-refresh" type="button" disabled={busy} onClick={() => void search()} aria-label="Refresh nearby spots"><RefreshCw size={17} className={busy ? "is-spinning" : ""} /></button>
        </div>
        {searched ? (
          <div className="safe-map-canvas" role="group" aria-label={`Schematic, not-to-scale view of ${filteredPlaces.length} nearby public places`}>
            <div className="safe-map-block safe-map-block-one" />
            <div className="safe-map-block safe-map-block-two" />
            <div className="safe-map-block safe-map-block-three" />
            <span className="safe-map-road safe-map-road-a" />
            <span className="safe-map-road safe-map-road-b" />
            <span className="safe-map-road safe-map-road-c" />
            <span className="safe-map-label safe-map-label-a">NEARBY</span>
            {point && <span className="safe-map-you" style={places.length ? mapPosition({ lat: point.lat, lng: point.lng, id: "you", name: "You", category: "other_public", address: null, quality: 0, open_24h: false }, places, point) : { left: "50%", top: "50%" }}><i /><b>You</b></span>}
            {filteredPlaces.map((place) => {
              const Icon = categoryIcons[place.category] ?? Building2;
              return <button key={place.id} type="button" className={`safe-map-pin${selectedSpot === place.id ? " is-selected" : ""}`} style={mapPosition(place, places, point)} onClick={() => { setSelectedSpot(selectedSpot === place.id ? null : place.id); document.getElementById(`safe-spot-${place.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} aria-label={`Show ${place.name}`} aria-pressed={selectedSpot === place.id}><Icon size={15} /></button>;
            })}
            {filteredPlaces.length === 0 && <p className="safe-map-empty">{places.length ? "No spots in this category." : "No reviewed spots found nearby yet."}</p>}
            <span className="safe-map-disclaimer">Approximate layout · not a navigation map</span>
          </div>
        ) : (
          <div className="safe-map-intro">
            <span className="safe-map-intro-icon"><LocateFixed size={25} /></span>
            <div><b>See public places around you</b><p>Share your location to find reviewed places nearby.</p></div>
            <button type="button" className="safe-map-search" disabled={busy} onClick={() => void search()}>{busy ? "Finding…" : "Search near me"}<ChevronRight size={16} /></button>
          </div>
        )}
        {searched && <div className="safe-map-legend"><span><i className="safe-legend-pin" />Safe spot</span><span><i className="safe-legend-you" />Your area</span><small>Location stays on your device until you search.</small></div>}
      </section>

      {searched && categories.length > 0 && <div className="safe-category-chips" aria-label="Filter spots by category">
        <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setSelectedSpot(null); }}>All <span>{places.length}</span></button>
        {categories.map((value) => {
          const Icon = categoryIcons[value] ?? Building2;
          const count = places.filter((place) => place.category === value).length;
          return <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setSelectedSpot(null); }}><Icon size={14} />{prettyCategory(value)}<span>{count}</span></button>;
        })}
      </div>}

      <div className="safe-spots-list-heading"><div><h2>Nearby spots</h2><p>{searched ? "Public places reviewed for your area" : "Places where you can meet or ask for help"}</p></div><span>{searched ? filteredPlaces.length : "—"}</span></div>
      {!searched ? (
        <button className="safe-search-prompt" type="button" disabled={busy} onClick={() => void search()}><LocateFixed size={19} /><span><b>Search nearby</b><small>Find reviewed public places around your current location.</small></span><ChevronRight size={18} /></button>
      ) : filteredPlaces.length ? (
        <div className="safe-spot-list">{filteredPlaces.map((place) => {
          const Icon = categoryIcons[place.category] ?? Building2;
          return <article className={`safe-spot-card${selectedSpot === place.id ? " is-selected" : ""}`} id={`safe-spot-${place.id}`} key={place.id}>
            <button type="button" className="safe-spot-title" onClick={() => setSelectedSpot(selectedSpot === place.id ? null : place.id)} aria-pressed={selectedSpot === place.id}>
              <span className="safe-spot-icon"><Icon size={19} /></span>
              <span className="safe-spot-name"><b>{place.name}</b><small>{prettyCategory(place.category)}</small></span>
              <ChevronRight size={17} />
            </button>
            <p className="safe-spot-address">{place.address || "Address not provided"}</p>
            <div className="safe-spot-footer">
              <span className="safe-reviewed-badge"><ShieldCheck size={14} />Reviewed spot</span>
              <span className="safe-hours-badge"><Clock3 size={13} />{place.open_24h ? "Open 24 hours" : "Hours may vary"}</span>
              <a className="safe-directions-link" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a>
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
      <CommunityAlertsPanel alerts={alerts} busy={busy} onBusyChange={setBusy} onAlertsChange={setAlerts} onLocationChange={setPoint} onMessage={changeMessage} />
    </section>

    <section id="safe-panel-meetings" role="tabpanel" aria-labelledby="safe-tab-meetings" hidden={tab !== "meetings"} className="safe-spots-tab-panel">
      <div className="safe-meetings-heading"><span><Handshake size={20} /></span><div><h2>Your Bubble meetings</h2><p>Open a meeting to help your group choose a safe place together.</p></div></div>
      {bubbles.length > 0 ? <div className="safe-meeting-list">{bubbles.map((bubble, index) => <Link className="safe-meeting-card" key={bubble.id} href={`/account/buddies/meeting/${bubble.id}`}>
        <span className="safe-meeting-icon"><UsersRound size={19} /></span>
        <span className="safe-meeting-copy"><b>Bubble {index + 1}</b><small>{bubble.member_count} {bubble.member_count === 1 ? "Buddy" : "Buddies"} · Active meeting</small></span>
        <span className="safe-meeting-open">Open meeting<ChevronRight size={16} /></span>
      </Link>)}</div> : <div className="safe-empty-card"><span><Handshake size={21} /></span><b>No active Bubble meetings</b><p>Create or join a Bubble to choose a meeting spot together.</p><Link href="/account/trips?mode=travel-together">Go to Travel Together<ChevronRight size={15} /></Link></div>}
      <Link className="safe-meeting-create" href="/account/trips?mode=travel-together"><Handshake size={17} />Create or join a Bubble<ChevronRight size={16} /></Link>
      <section className="safe-meeting-note"><span><Check size={16} /></span><p>Meeting locations are shared with your Bubble members so everyone can make their way to the same public place.</p></section>
    </section>

    {message && <div className={`safe-spots-message${messageIsError ? " is-error" : ""}`} role={messageIsError ? "alert" : "status"}>{message}</div>}
  </div>;
}
