"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, LocateFixed, MapPinned, ShieldCheck, UsersRound } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useFaceCheck, type FacePurpose } from "@/hooks/useFaceCheck";

type Place = { label: string; lat: number; lng: number };
type Avatar = { ref: string; nickname: string; avatar: string; ring: number; angleDeg: number; radialPct: number; badges: string[]; destinationArea: string | null; mode: string };
const modes = ["walk", "taxi", "ehail", "bus", "train"] as const;
const tripErrorMessage: Record<string, string> = {
  invalid_trip: "That route has too much detail to use for a Buddy trip. Please choose another route.",
  trip_unavailable: "Buddy trips are temporarily unavailable. Please try again.",
  BUDDIES_UNAVAILABLE: "Buddies is not available right now.",
  forbidden: "Please refresh and try creating your Buddy trip again.",
};

export default function BuddiesPage() {
  const { position, error: locationError } = useGeolocation();
  const [query, setQuery] = useState(""); const [places, setPlaces] = useState<Place[]>([]); const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<(typeof modes)[number]>("walk"); const [visible, setVisible] = useState(false); const [active, setActive] = useState(false);
  const [avatars, setAvatars] = useState<Avatar[]>([]); const [message, setMessage] = useState(""); const [consent, setConsent] = useState(false); const [pending, setPending] = useState<FacePurpose | null>(null);
  const [selected, setSelected] = useState<Avatar | null>(null);
  const face = useFaceCheck();

  useEffect(() => {
    void fetch("/api/buddies/trips")
      .then((response) => response.ok ? response.json() : null)
      .then((trip) => {
        if (!trip?.active) return;
        setActive(true);
        setVisible(Boolean(trip.visible));
      });
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
    if (!active || !position) return;
    void fetch("/api/buddies/trips/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position) });
  }, [active, position?.lat, position?.lng]);

  async function createTrip() {
    if (!position || !destination) return setMessage("Choose a destination and enable location first.");
    const routeResponse = await fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode: mode === "walk" ? "walk" : "taxi" }) });
    const routeData = await routeResponse.json().catch(() => ({}));
    if (!routeResponse.ok || !routeData.routes?.[0]) return setMessage("Route planning is unavailable right now.");
    const response = await fetch("/api/buddies/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: position, destination, route: routeData.routes[0].points, mode, leaveFrom: new Date().toISOString(), maxWaitMinutes: 30, maxWalkM: 800, groupSize: 3, audience: "all_verified" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error === "not_verified" ? "Buddies requires verified enrolment." : tripErrorMessage[data.error] ?? "Trip could not be created.");
    setActive(true); setMessage(`Trip ready as ${data.alias}. Turn on visibility when you are ready.`);
  }

  async function gated(purpose: FacePurpose, action: () => Promise<void>) {
    setPending(purpose);
    if (!await face.run(purpose)) return;
    await action();
    setPending(null);
  }

  async function setVisibility(next: boolean): Promise<void> {
    const response = await fetch("/api/buddies/visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visible: next }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { await gated("visibility", async () => { await setVisibility(next); }); return; }
    if (!response.ok) return setMessage(data.error ?? "Visibility could not be changed.");
    setVisible(next); setConsent(false); setMessage(next ? "You are visible through privacy-preserving rings." : "You are no longer visible and your face proof was cleared.");
  }

  async function refreshNearby() {
    const response = await fetch("/api/buddies/nearby");
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) return gated("nearby", refreshNearby);
    if (!response.ok) return setMessage(data.error ?? "Nearby is unavailable.");
    setAvatars(data.avatars ?? []);
  }

  async function ping() {
    if (!selected) return;
    const response = await fetch("/api/buddies/ping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: selected.ref }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) return gated("ping", ping);
    setMessage(response.ok ? "Buddy request sent." : data.error ?? "Buddy request could not be sent.");
  }

  return <div className="buddies-page">
    <div className="buddies-heading"><div><p className="eyebrow">Travel together</p><h1 className="page-title">Buddies</h1><p>Nearby matches are shown as privacy-preserving rings, never as exact locations.</p></div><span><ShieldCheck size={17} /> Verified travel</span></div>
    {!active && <section className="buddies-panel"><h2>Plan a Buddy trip</h2><label className="hamba-search"><MapPinned size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); }} placeholder="Where are you going?" /></label>{places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} type="button" onClick={() => { setDestination(place); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}<div className="buddies-modes">{modes.map((item) => <button key={item} className={mode === item ? "active" : ""} type="button" onClick={() => setMode(item)}>{item}</button>)}</div><button className="btn btn-primary" disabled={!position || !destination} onClick={() => void createTrip()}>Create Buddy trip</button>{!position && <p className="hamba-note"><LocateFixed size={16} /> {locationError ?? "Enable location to plan your trip."}</p>}</section>}
    {active && <><section className="buddies-panel buddies-visibility"><div><h2>Be visible to Buddies</h2><p>Others see only your generated alias, avatar, travel mode, broad destination area, and ring.</p></div><button className={`buddies-toggle ${visible ? "on" : ""}`} type="button" aria-pressed={visible} onClick={() => visible ? void setVisibility(false) : setConsent(true)}>{visible ? <Eye size={17} /> : <EyeOff size={17} />}{visible ? "Visible" : "Off"}</button></section>
      {consent && <section className="buddies-consent"><h2>Enable visibility?</h2><p>Your exact location, route, legal name, phone number, and email are never shared. A fresh face check protects your account before you become visible.</p><button className="btn" onClick={() => setConsent(false)}>Cancel</button><button className="btn btn-primary" onClick={() => void setVisibility(true)}>Continue</button></section>}
      {pending && <section className="buddies-consent"><h2>Face check</h2><p>{face.state === "preparing" || face.state === "checking" ? "Checking securely..." : face.message}</p><label className="label">Simulation result<select className="input mt-1" value={face.simulationOutcome} onChange={(event) => face.setSimulationOutcome(event.target.value)}><option value="pass">Pass</option><option value="liveness_fail">Liveness fail</option><option value="face_mismatch">Face mismatch</option><option value="timeout">Timeout</option><option value="provider_error">Provider error</option></select></label><button className="btn btn-primary mt-3" onClick={() => void gated(pending, pending === "visibility" ? () => setVisibility(true) : refreshNearby)}>Retry</button></section>}
      {visible && <section className="buddies-panel"><div className="buddies-map" aria-label="Nearby Buddy rings"><span className="buddies-me">You</span>{[0, 1, 2].map((ring) => <i key={ring} className={`buddies-ring ring-${ring}`} />)}{avatars.map((avatar) => <button key={avatar.ref} onClick={() => setSelected(avatar)} className={`buddies-avatar ring-${avatar.ring}`} style={{ transform: `rotate(${avatar.angleDeg}deg) translateY(${-72 - avatar.ring * 64 * avatar.radialPct}px) rotate(${-avatar.angleDeg}deg)` }} title={`${avatar.nickname}, ${avatar.mode}`}><span>{avatar.avatar}</span><small>{avatar.nickname}</small></button>)}</div><button className="btn" onClick={() => void refreshNearby()}><UsersRound size={17} /> Refresh nearby</button>{selected && <div className="buddies-selected"><b>{selected.avatar} {selected.nickname}</b><span>{selected.mode}{selected.destinationArea ? ` to ${selected.destinationArea}` : ""}</span><button className="btn btn-primary" onClick={() => void ping()}>Ping</button></div>}{avatars.length === 0 && <p className="muted text-[12px] mt-3">No compatible visible Buddies nearby right now.</p>}</section>}</>}
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}