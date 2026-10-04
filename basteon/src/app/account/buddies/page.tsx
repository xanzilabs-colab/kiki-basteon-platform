"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Car, Eye, EyeOff, Footprints, Handshake, LocateFixed, MapPinned, RefreshCw, ShieldCheck, TrainFront, UserPlus } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useFaceCheck, type FacePurpose } from "@/hooks/useFaceCheck";
import { BUDDY_CONFIG } from "@/lib/buddies/config";

type Place = { label: string; lat: number; lng: number };
type Avatar = { ref: string; nickname: string; avatar: string; ring: number; angleDeg: number; radialPct: number; badges: string[]; destinationArea: string | null; mode: string };
const modes = ["walk", "taxi", "ehail", "bus", "train"] as const;
const modeTiles = [
  { value: "taxi", label: "Taxi", icon: Bus },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "ehail", label: "Ehail", icon: Car },
  { value: "bus", label: "Bus", icon: Bus },
  { value: "train", label: "Train", icon: TrainFront },
] as const;
const tripErrorMessage: Record<string, string> = {
  invalid_trip: "That route has too much detail to use for a Buddy trip. Please choose another route.",
  trip_unavailable: "Buddy trips are temporarily unavailable. Please try again.",
  BUDDIES_UNAVAILABLE: "Buddies is not available right now.",
  forbidden: "Please refresh and try creating your Buddy trip again.",
};
const nearbyErrorMessage: Record<string, string> = {
  refresh_limited: "Nearby is refreshing too often. Please wait a moment.",
  moderation_review: "Nearby is paused while your account is reviewed.",
  not_verified: "Buddies requires verified enrolment.",
};
const joinErrorMessage: Record<string, string> = {
  target_not_available: "That Buddy is no longer nearby. Refresh and choose again.",
  daily_limit: "You've reached today's Buddy join limit.",
  cooldown: "You can't join this Buddy right now.",
  no_active_trip: "Start a Buddy trip before joining someone.",
  bubble_unavailable: "The Buddy bubble could not be created. Please try again.",
};

export default function BuddiesPage() {
  const { position, error: locationError } = useGeolocation();
  const [query, setQuery] = useState(""); const [places, setPlaces] = useState<Place[]>([]); const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<(typeof modes)[number]>("walk"); const [visible, setVisible] = useState(false); const [active, setActive] = useState(false);
  const [avatars, setAvatars] = useState<Avatar[]>([]); const [message, setMessage] = useState(""); const [consent, setConsent] = useState(false); const [pending, setPending] = useState<FacePurpose | null>(null);
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [alias, setAlias] = useState("");
  const [nearbyLoaded, setNearbyLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [planningNewTrip, setPlanningNewTrip] = useState(false);
  const face = useFaceCheck();
  const router = useRouter();
  const nearbyInFlight = useRef(false);
  const lastNearbyAt = useRef(0);
  const autoRefresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    void fetch("/api/buddies/trips")
      .then((response) => response.ok ? response.json() : null)
      .then((trip) => {
        if (!trip?.active) return;
        setActive(true);
        setVisible(Boolean(trip.visible));
        setAlias(trip.alias ?? "");
      }).catch(() => setMessage("Your Buddy trip could not be loaded. Please refresh."));
  }, []);

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
    if (!active || !position) return;
    void fetch("/api/buddies/trips/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position) });
  }, [active, position?.lat, position?.lng]);

  async function createTrip() {
    if (!position || !destination) return setMessage("Choose a destination and enable location first.");
    setBusy(true);
    try {
    const routeResponse = await fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode: mode === "walk" ? "walk" : "taxi" }) });
    const routeData = await routeResponse.json().catch(() => ({}));
    if (!routeResponse.ok || !routeData.routes?.[0]) return setMessage("Route planning is unavailable right now.");
    const response = await fetch("/api/buddies/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: position, destination, route: routeData.routes[0].points, mode, leaveFrom: new Date().toISOString(), maxWaitMinutes: 30, maxWalkM: 800, groupSize: 3, audience: "all_verified" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error === "not_verified" ? "Buddies requires verified enrolment." : tripErrorMessage[data.error] ?? "Trip could not be created.");
    setActive(true); setPlanningNewTrip(false); setAlias(data.alias); setMessage(`Trip ready as ${data.alias}. Turn on visibility when you are ready.`);
    } catch { setMessage("Your Buddy trip could not be created. Check your connection and try again."); }
    finally { setBusy(false); }
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
    setVisible(next); setConsent(false);
    if (!next) { setAvatars([]); setSelected(null); setNearbyLoaded(false); setPending(null); }
    setMessage(next ? "You are visible through privacy-preserving rings." : "You are no longer visible and your face proof was cleared.");
  }

  async function refreshNearby(auto = false): Promise<void> {
    if (nearbyInFlight.current) return;
    nearbyInFlight.current = true;
    try {
      const response = await fetch("/api/buddies/nearby", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      lastNearbyAt.current = Date.now();
      if (response.status === 401) {
        if (auto) { setMessage("Tap Refresh nearby to complete a face check."); return; }
        nearbyInFlight.current = false;
        return gated("nearby", () => refreshNearby());
      }
      if (!response.ok) { if (!auto || data.error !== "refresh_limited") setMessage(nearbyErrorMessage[data.error] ?? "Nearby is unavailable."); return; }
      const next: Avatar[] = data.avatars ?? [];
      setAvatars(next);
      setSelected((current) => current ? next.find((avatar) => avatar.ref === current.ref) ?? null : null);
      setNearbyLoaded(true);
    } catch { if (!auto) setMessage("Nearby is unavailable. Check your connection."); }
    finally { nearbyInFlight.current = false; }
  }
  autoRefresh.current = () => refreshNearby(true);

  useEffect(() => {
    if (!visible) return;
    void autoRefresh.current();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastNearbyAt.current < BUDDY_CONFIG.minRefreshMs) return;
      void autoRefresh.current();
    }, BUDDY_CONFIG.minRefreshMs / 3);
    return () => window.clearInterval(timer);
  }, [visible]);

  async function join(): Promise<void> {
    if (!selected || joining) return;
    setJoining(true);
    try {
      const response = await fetch("/api/buddies/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: selected.ref }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setJoining(false); return gated("ping", join); }
      if (!response.ok || typeof data.bubbleId !== "string") return setMessage(joinErrorMessage[data.error] ?? "Could not join this Buddy. Please try again.");
      setMessage(data.alreadyMember ? "You're already in a bubble with this Buddy." : "Joined. Opening your Buddy bubble...");
      router.push(`/account/buddies/bubble/${encodeURIComponent(data.bubbleId)}`);
    } catch { setMessage("Could not join this Buddy. Check your connection."); }
    finally { setJoining(false); }
  }

  return <div className="buddies-page">
    <div className="buddies-heading"><div><p className="eyebrow">Privacy-first matching</p><h1 className="page-title">Travel together</h1></div><div className="flex items-center gap-2"><Link className="btn" href="/account/buddies/history">History</Link><span><ShieldCheck size={16} />Verified travel</span></div></div>
    <section className="buddies-panel buddies-radar-panel">
      <div className="buddies-map" aria-label="Approximate Buddy zones, not geographic locations">
        {[0, 1, 2].map((ring) => <i key={ring} className={`buddies-ring ring-${ring}`} />)}
        <span className="buddies-zone-label">Approximate zones</span>
        <span className="buddies-me">YOU</span>
        {visible && avatars.map((avatar) => {
          const radius = Math.min(42, 20 + avatar.ring * 10 * avatar.radialPct);
          const radians = avatar.angleDeg * Math.PI / 180;
          return <button key={avatar.ref} type="button" aria-pressed={selected?.ref === avatar.ref} onClick={() => setSelected(avatar)} className={`buddies-avatar ring-${avatar.ring}`} style={{ left: `${50 + Math.sin(radians) * radius}%`, top: `${50 - Math.cos(radians) * radius}%` }} title={`${avatar.nickname}, ${avatar.mode}`} aria-label={`Select ${avatar.nickname}, ${avatar.mode}`}><span>{avatar.avatar}</span></button>;
        })}
      </div>
      <p className="buddies-privacy-note">Exact locations are hidden. Matches use generated aliases and broad travel zones.</p>
      {visible && <><button className="btn buddies-refresh" onClick={() => void refreshNearby()} title={`Nearby also refreshes automatically every ${BUDDY_CONFIG.minRefreshMs / 1000} seconds`}><RefreshCw size={16} />Refresh nearby</button>{nearbyLoaded && avatars.length === 0 && <p className="buddies-privacy-note">No compatible visible Buddies nearby right now.</p>}</>}
    </section>
    <section className="buddies-panel buddies-plan-widget">
      <h2><UserPlus size={18} />{active && !planningNewTrip ? "Join a travel Buddy" : "Plan a Buddy walk / ride"}</h2>
      {(!active || planningNewTrip) ? <>
        <label className="hamba-field-label" htmlFor="buddy-destination">Where are you going?</label>
        <div className="hamba-search"><MapPinned size={18} /><input id="buddy-destination" value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); }} placeholder="Type destination address..." autoComplete="off" /></div>
        {places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} type="button" onClick={() => { setDestination(place); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}
        <span className="hamba-field-label">Travel mode</span>
        <div className="hamba-mode" role="group" aria-label="Buddy travel mode">{modeTiles.map((item) => <button key={item.value} className={mode === item.value ? "active" : ""} aria-pressed={mode === item.value} type="button" onClick={() => setMode(item.value)}><item.icon size={18} /><span>{item.label}</span></button>)}</div>
        <p className="buddies-invite-notice"><ShieldCheck size={17} />Your trip starts hidden. Visibility requires consent and a fresh face check.</p>
        <button className="btn btn-primary hamba-start" disabled={!position || !destination || busy} onClick={() => void createTrip()}><UserPlus size={16} />{busy ? "Creating..." : active ? "Replace Buddy trip" : "Create Buddy trip"}</button>
        {active && <button className="btn hamba-start" disabled={busy} onClick={() => setPlanningNewTrip(false)}>Keep current trip</button>}
        {!position && <p className="hamba-note"><LocateFixed size={16} />{locationError ?? "Enable location to plan your trip."}</p>}
      </> : <>
        <button className="btn hamba-start" onClick={() => { setPlanningNewTrip(true); setMessage("Plan a new trip. Your existing trip stays active until you create the replacement."); }}><UserPlus size={16} />Plan another trip</button>
        <div className="buddies-visibility"><div><h3>Be visible to Buddies</h3><p>{alias ? `Your alias: ${alias}. ` : ""}Only your alias, avatar, mode, destination area, and zone are shared.</p></div><button className={`buddies-toggle ${visible ? "on" : ""}`} type="button" aria-pressed={visible} onClick={() => visible ? void setVisibility(false) : setConsent(true)}>{visible ? <Eye size={17} /> : <EyeOff size={17} />}{visible ? "Visible" : "Off"}</button></div>
        <div className="buddies-invite-notice">{visible && selected ? <><span className="buddies-selected-avatar">{selected.avatar}</span><div><b>{selected.nickname}</b><span>{selected.mode}{selected.destinationArea ? ` to ${selected.destinationArea}` : ""}</span></div></> : <><UserPlus size={18} /><span>{visible ? "No Buddy selected" : "Your trip is hidden"}</span></>}</div>
        <button className="btn btn-primary hamba-start" disabled={!visible || !selected || joining} onClick={() => void join()}><Handshake size={16} />{joining ? "Joining..." : "Join Buddy"}</button>
      </>}
    </section>
    {active && consent && <section className="buddies-consent"><h2>Enable visibility?</h2><p>Your exact location, route, legal name, phone number, and email are never shared. A fresh face check protects your account before you become visible.</p><button className="btn" onClick={() => setConsent(false)}>Cancel</button><button className="btn btn-primary" onClick={() => void setVisibility(true)}>Continue</button></section>}
    {active && pending && <section className="buddies-consent"><h2>Face check</h2><p>{face.state === "preparing" || face.state === "checking" ? "Checking securely..." : face.message}</p><label className="label">Simulation result<select className="input mt-1" value={face.simulationOutcome} onChange={(event) => face.setSimulationOutcome(event.target.value)}><option value="pass">Pass</option><option value="liveness_fail">Liveness fail</option><option value="face_mismatch">Face mismatch</option><option value="timeout">Timeout</option><option value="provider_error">Provider error</option></select></label><button className="btn btn-primary mt-3" disabled={face.state === "preparing" || face.state === "checking"} onClick={() => void gated(pending, pending === "visibility" ? () => setVisibility(true) : pending === "ping" ? join : () => refreshNearby())}>Retry</button></section>}
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}