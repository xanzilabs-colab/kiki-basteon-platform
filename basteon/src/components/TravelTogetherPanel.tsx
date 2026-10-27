"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, Car, Clock3, Eye, EyeOff, Footprints, Handshake, LocateFixed, MapPinned, RefreshCw, ShieldCheck, TrainFront, UserCheck, UserPlus, UsersRound, X } from "lucide-react";
import type { Position } from "@/lib/geo";
import { useFaceCheck, type FacePurpose } from "@/hooks/useFaceCheck";
import { BUDDY_CONFIG } from "@/lib/buddies/config";
import radarStyles from "@/app/games/games.module.css";
import { radarMarkerPosition } from "@/lib/buddies/radarLayout";

type Place = { label: string; lat: number; lng: number };
type Avatar = { ref: string; nickname: string; avatar: string; ring: number; angleDeg: number; radialPct: number; badges: string[]; destinationArea: string | null; mode: string };
type BubbleMarker = Avatar & { id: string; memberCount: number };
type Buddy = { id: string; kikiId: string; name: string; avatarUrl: string | null };
type TravelInvitation = { id: string; mode: string; buddy: Buddy | null; expiresAt: string };
const modes = ["walk", "taxi", "ehail", "bus", "train"] as const;
const modeTiles = [
  { value: "taxi", label: "Taxi", icon: Bus },
  { value: "walk", label: "Walk", icon: Footprints },
  { value: "ehail", label: "E-hail", icon: Car },
  { value: "bus", label: "Bus", icon: Bus },
  { value: "train", label: "Train", icon: TrainFront },
] as const;
const tripErrorMessage: Record<string, string> = {
  invalid_trip: "That route has too much detail to use for a Travel Together trip. Please choose another route.",
  trip_unavailable: "Travel Together is temporarily unavailable. Please try again.",
  BUDDIES_UNAVAILABLE: "Travel Together is not available right now.",
  forbidden: "Please refresh and try creating your Travel Together trip again.",
};
const nearbyErrorMessage: Record<string, string> = {
  refresh_limited: "Nearby is refreshing too often. Please wait a moment.",
  moderation_review: "Nearby is paused while your account is reviewed.",
  not_verified: "Travel Together requires verified enrolment.",
};
const joinErrorMessage: Record<string, string> = {
  target_not_available: "That traveler is no longer nearby. Refresh and choose again.",
  daily_limit: "You've reached today's Travel Together join limit.",
  cooldown: "You can't join this traveler right now.",
  no_active_trip: "Start a Travel Together trip before joining someone.",
  bubble_unavailable: "The travel group could not be created. Please try again.",
};
const invitationErrorMessage: Record<string, string> = {
  no_active_trip: "Plan your own Travel Together trip before accepting this invitation.",
  not_buddies: "This invitation is no longer available because you are not connected as buddies.",
  invitation_pending: "An invitation is already waiting for this buddy.",
  already_joined: "This buddy has already joined your travel group.",
  invitation_expired: "This Travel Together invitation has expired.",
  FACE_CHECK_REQUIRED: "Complete a quick face check to join this travel group.",
};

export function TravelTogetherPanel({
  position,
  locationError,
  refreshingLocation,
  refreshLocation,
}: {
  position: Position | null;
  locationError: string | null;
  refreshingLocation: boolean;
  refreshLocation: () => Promise<void>;
}) {
  const [query, setQuery] = useState(""); const [places, setPlaces] = useState<Place[]>([]); const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<(typeof modes)[number]>("walk"); const [visible, setVisible] = useState(false); const [active, setActive] = useState(false);
  const [avatars, setAvatars] = useState<Avatar[]>([]); const [bubbles, setBubbles] = useState<BubbleMarker[]>([]); const [message, setMessage] = useState(""); const [consent, setConsent] = useState(false); const [pending, setPending] = useState<FacePurpose | null>(null);
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [alias, setAlias] = useState("");
  const [ownAvatar, setOwnAvatar] = useState("🧭");
  const [nearbyLoaded, setNearbyLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [planningNewTrip, setPlanningNewTrip] = useState(false);
  const [buddyContacts, setBuddyContacts] = useState<Buddy[]>([]);
  const [incomingInvitations, setIncomingInvitations] = useState<TravelInvitation[]>([]);
  const [outgoingInvitations, setOutgoingInvitations] = useState<TravelInvitation[]>([]);
  const [invitationBusy, setInvitationBusy] = useState("");
  const face = useFaceCheck();
  const router = useRouter();
  const nearbyInFlight = useRef(false);
  const positionInFlight = useRef(false);
  const hiddenBubbleIds = useRef(new Set<string>());
  const lastNearbyAt = useRef(0);
  const autoRefresh = useRef<() => Promise<void>>(async () => {});

  async function refreshInvitations(): Promise<void> {
    try {
      const [buddiesResponse, invitationsResponse] = await Promise.all([
        fetch("/api/account/buddies", { cache: "no-store" }),
        fetch("/api/buddies/invitations", { cache: "no-store" }),
      ]);
      if (buddiesResponse.ok) {
        const data = await buddiesResponse.json();
        setBuddyContacts(Array.isArray(data.buddies) ? data.buddies : []);
      }
      if (invitationsResponse.ok) {
        const data = await invitationsResponse.json();
        setIncomingInvitations(Array.isArray(data.incoming) ? data.incoming : []);
        setOutgoingInvitations(Array.isArray(data.outgoing) ? data.outgoing : []);
      }
    } catch {
      setMessage("Buddy invitations could not be refreshed. Check your connection.");
    }
  }

  async function refreshTripState(): Promise<void> {
    const response = await fetch("/api/buddies/trips", { cache: "no-store" });
    if (!response.ok) throw new Error("Travel Together trip state could not be loaded");
    const trip = await response.json();
    const hasActiveTrip = Boolean(trip?.active);
    setActive(hasActiveTrip);
    setVisible(hasActiveTrip && Boolean(trip.visible));
    setAlias(hasActiveTrip ? trip.alias ?? "" : "");
    setOwnAvatar(hasActiveTrip ? trip.avatar ?? "🧭" : "🧭");
    if (!hasActiveTrip) setPlanningNewTrip(true);
  }

  useEffect(() => {
    void refreshInvitations();
    void refreshTripState().catch(() => setMessage("Your Travel Together trip could not be loaded. Please refresh."));
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
    if (!active || !position || positionInFlight.current) return;
    positionInFlight.current = true;
    void fetch("/api/buddies/trips/position", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position) })
      .catch(() => undefined)
      .finally(() => { positionInFlight.current = false; });
  }, [active, position?.lat, position?.lng]);

  async function createTrip() {
    if (!position || !destination) return setMessage("Choose a destination and enable location first.");
    setBusy(true);
    try {
    const routeResponse = await fetch("/api/trips/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: position, destination, mode: mode === "walk" ? "walk" : "taxi" }) });
    const routeData = await routeResponse.json().catch(() => ({}));
    if (!routeResponse.ok || !routeData.routes?.[0]) return setMessage("Route planning is unavailable right now.");
    const response = await fetch("/api/buddies/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: position, destination, route: routeData.routes[0].points, mode, maxWaitMinutes: 30, maxWalkM: 800, groupSize: 3, audience: "all_verified" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      try {
        await refreshTripState();
      } catch {
        return setMessage("Trip could not be created, and your current trip status could not be checked. Please refresh.");
      }
      return setMessage(data.error === "not_verified" ? "Travel Together requires verified enrolment." : tripErrorMessage[data.error] ?? "Trip could not be created.");
    }
    hiddenBubbleIds.current.clear(); setBubbles([]); setActive(true); setPlanningNewTrip(false); setAlias(data.alias); setOwnAvatar(data.avatar ?? "🧭"); setMessage(`Trip ready as ${data.alias}. Turn on visibility when you are ready.`);
    void refreshInvitations();
    } catch {
      try {
        await refreshTripState();
        setMessage("Trip creation could not be confirmed. Your current trip status was refreshed.");
      } catch {
        setMessage("Your Travel Together trip could not be created or verified. Check your connection and refresh.");
      }
    }
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
    if (!response.ok) {
      if (data.error === "no_active_trip") {
        setActive(false);
        setVisible(false);
        setPlanningNewTrip(true);
        setConsent(false);
        setMessage("Your Travel Together trip is no longer active. Create a trip again, then turn on visibility.");
        return;
      }
      return setMessage(data.error ?? "Visibility could not be changed.");
    }
    setVisible(next); setConsent(false);
    if (!next) { setAvatars([]); setBubbles([]); setSelected(null); setNearbyLoaded(false); setPending(null); }
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
      const nextBubbles: BubbleMarker[] = (data.bubbles ?? []).filter((bubble: BubbleMarker) => !hiddenBubbleIds.current.has(bubble.id));
      setAvatars(next);
      setBubbles(nextBubbles);
      setSelected((current) => current ? [...next, ...nextBubbles].find((avatar) => avatar.ref === current.ref) ?? null : null);
      setNearbyLoaded(true);
    } catch { if (!auto) setMessage("Nearby is unavailable. Check your connection."); }
    finally { nearbyInFlight.current = false; }
  }
  autoRefresh.current = () => refreshNearby(true);

  function clearMapGroups() {
    for (const bubble of bubbles) hiddenBubbleIds.current.add(bubble.id);
    if (selected && bubbles.some((bubble) => bubble.ref === selected.ref)) setSelected(null);
    setBubbles([]);
    setMessage("Existing group markers cleared from this map. New travel groups will still appear.");
  }

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
      if (!response.ok || typeof data.bubbleId !== "string") return setMessage(joinErrorMessage[data.error] ?? "Could not join this traveler. Please try again.");
      setMessage(data.alreadyMember ? "You're already in this travel group." : "Joined. Opening your travel group...");
      router.push(`/account/buddies/bubble/${encodeURIComponent(data.bubbleId)}`);
    } catch { setMessage("Could not join this traveler. Check your connection."); }
    finally { setJoining(false); }
  }

  async function sendTravelInvitation(buddyId: string): Promise<void> {
    if (invitationBusy) return;
    setInvitationBusy(buddyId);
    try {
      const response = await fetch("/api/buddies/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buddyId }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.error === "FACE_CHECK_REQUIRED") {
        setInvitationBusy("");
        await gated("ping", () => sendTravelInvitation(buddyId));
        return;
      }
      if (!response.ok) {
        if (data.error === "no_active_trip") {
          setActive(false);
          setVisible(false);
          setPlanningNewTrip(true);
          setMessage("Your Travel Together trip is no longer active. Create a trip before inviting a buddy.");
          return;
        }
        setMessage(invitationErrorMessage[data.error] ?? "The Travel Together invitation could not be sent.");
        return;
      }
      setMessage("Travel Together invitation sent. Your buddy must accept before joining.");
      await refreshInvitations();
    } catch {
      setMessage("The Travel Together invitation could not be sent. Check your connection.");
    } finally {
      setInvitationBusy("");
    }
  }

  async function answerTravelInvitation(invitationId: string, action: "accept" | "decline"): Promise<void> {
    if (invitationBusy) return;
    setInvitationBusy(invitationId);
    try {
      const response = await fetch("/api/buddies/invitations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.error === "FACE_CHECK_REQUIRED") {
        setInvitationBusy("");
        await gated("ping", () => answerTravelInvitation(invitationId, action));
        return;
      }
      if (!response.ok) {
        if (data.error === "no_active_trip") setPlanningNewTrip(true);
        setMessage(invitationErrorMessage[data.error] ?? "The invitation could not be answered.");
        return;
      }
      await refreshInvitations();
      if (action === "accept" && typeof data.bubbleId === "string") {
        router.push(`/account/buddies/bubble/${encodeURIComponent(data.bubbleId)}`);
        return;
      }
      setMessage("Travel Together invitation declined.");
    } catch {
      setMessage("The invitation could not be answered. Check your connection.");
    } finally {
      setInvitationBusy("");
    }
  }

  return <div className="buddies-page">
    <div className="buddies-heading"><div><p className="eyebrow">Privacy-first matching</p><h1 className="page-title">Travel together</h1></div><div className="flex flex-wrap items-center gap-2"><Link className="btn" href="/account/buddies/safe-places"><MapPinned size={16} />Safe spots & reports</Link><Link className="btn" href="/account/buddies/history"><Clock3 size={16} />History</Link><span><ShieldCheck size={16} />Verified travel</span></div></div>
    <section className="buddies-panel buddies-radar-panel">
      <div className={radarStyles.gardenPond} aria-label="Approximate Travel Together zones, not geographic locations">
        <div className={radarStyles.pondWash} />
        <div className={`${radarStyles.pondRipple} ${radarStyles.travelPondRipple} ${radarStyles.rippleOne}`} />
        <div className={`${radarStyles.pondRipple} ${radarStyles.travelPondRipple} ${radarStyles.rippleTwo}`} />
        <div className={`${radarStyles.pondRipple} ${radarStyles.travelPondRipple} ${radarStyles.rippleThree}`} />
        <div className={radarStyles.pondGuide} />
        <div className={radarStyles.pondGuideInner} />
        {visible && bubbles.map((bubble, index) => {
          const position = radarMarkerPosition(bubble.angleDeg, bubble.radialPct);
          const tone = ["", radarStyles.gardenBuddyTone1, radarStyles.gardenBuddyTone2, radarStyles.gardenBuddyTone3][index % 4];
          return (
            <button
              key={bubble.id}
              type="button"
              aria-pressed={selected?.ref === bubble.ref}
              onClick={() => setSelected(bubble)}
              className={`${radarStyles.gardenBuddy} ${tone}`}
              style={{ left: `${position.left}%`, top: `${position.top}%` }}
              title={`${bubble.memberCount} travelers travelling together`}
              aria-label={`Select travel group with ${bubble.memberCount} members`}
            >
              <span className={radarStyles.gardenBuddyMark}>{bubble.avatar}</span>
              <span className={radarStyles.gardenBuddyLabel}><strong>Bubble</strong><small>{bubble.memberCount} members</small></span>
            </button>
          );
        })}
        {visible && avatars.map((avatar, index) => {
          const position = radarMarkerPosition(avatar.angleDeg, avatar.radialPct);
          const tone = ["", radarStyles.gardenBuddyTone1, radarStyles.gardenBuddyTone2, radarStyles.gardenBuddyTone3][index % 4];
          return (
            <button
              key={avatar.ref}
              type="button"
              aria-pressed={selected?.ref === avatar.ref}
              onClick={() => setSelected(avatar)}
              className={`${radarStyles.gardenBuddy} ${tone}`}
              style={{ left: `${position.left}%`, top: `${position.top}%` }}
              title={`${avatar.nickname}, ${avatar.mode}`}
              aria-label={`Select ${avatar.nickname}, ${avatar.mode}`}
            >
              <span className={radarStyles.gardenBuddyMark}>{avatar.avatar}</span>
              <span className={radarStyles.gardenBuddyLabel}><strong>{avatar.nickname}</strong><small>{avatar.mode}</small></span>
            </button>
          );
        })}
        <button type="button" className={radarStyles.gardenYou} aria-label="Your location is represented by the broad center ring">
          <span className={radarStyles.gardenYouMark} aria-hidden="true">{ownAvatar}</span>
          <span className={radarStyles.gardenYouLabel}>YOU</span>
        </button>
      </div>
      <p className="buddies-privacy-note">Exact locations are hidden. Matches use generated aliases and broad travel zones.</p>
      {visible && <><div className="flex items-center justify-center gap-2"><button className="btn buddies-refresh" onClick={() => void refreshNearby()} title={`Nearby also refreshes automatically every ${BUDDY_CONFIG.minRefreshMs / 1000} seconds`}><RefreshCw size={16} />Refresh nearby</button><button className="btn buddies-refresh px-3" onClick={clearMapGroups} title="Clear existing group markers from this map" aria-label="Clear existing group markers"><X size={16} /></button></div>{nearbyLoaded && avatars.length + bubbles.length === 0 && <p className="buddies-privacy-note">No compatible travelers nearby right now.</p>}</>}
    </section>
    <section className="buddies-panel buddies-plan-widget">
      <h2><UserPlus size={18} />{active && !planningNewTrip ? "Join a travel group" : "Plan a walk or ride"}</h2>
      {(!active || planningNewTrip) ? <>
        <label className="hamba-field-label" htmlFor="buddy-destination">Where are you going?</label>
        <div className="hamba-search"><MapPinned size={18} /><input id="buddy-destination" value={query} onChange={(event) => { setQuery(event.target.value); setDestination(null); }} placeholder="Type destination address..." autoComplete="off" /></div>
        {places.length > 0 && <div className="hamba-suggestions">{places.map((place) => <button key={`${place.lat}-${place.lng}`} type="button" onClick={() => { setDestination(place); setQuery(place.label); setPlaces([]); }}>{place.label}</button>)}</div>}
        <span className="hamba-field-label">Travel mode</span>
        <div className="hamba-mode" role="group" aria-label="Travel Together mode">{modeTiles.map((item) => <button key={item.value} className={mode === item.value ? "active" : ""} aria-pressed={mode === item.value} type="button" onClick={() => setMode(item.value)}><item.icon size={18} /><span>{item.label}</span></button>)}</div>
        <p className="buddies-invite-notice"><ShieldCheck size={17} />Your trip starts hidden. Visibility requires consent and a fresh face check.</p>
        <button className="btn btn-primary hamba-start" disabled={!position || !destination || busy} onClick={() => void createTrip()}><UserPlus size={16} />{busy ? "Creating..." : active ? "Replace trip" : "Create travel group"}</button>
        {active && <button className="btn hamba-start" disabled={busy} onClick={() => setPlanningNewTrip(false)}>Keep current trip</button>}
        {!position && <div className="hamba-note" role="status">
          <LocateFixed size={16} /><span>{locationError ?? "Allow location for this site to plan your trip."}</span>
          <button className="btn" type="button" disabled={refreshingLocation} onClick={() => void refreshLocation()}>
            {refreshingLocation ? "Checking…" : "Retry location"}
          </button>
        </div>}
      </> : <>
        <button className="btn hamba-start" onClick={() => { setPlanningNewTrip(true); setMessage("Plan a new trip. Your existing trip stays active until you create the replacement."); }}><UserPlus size={16} />Plan another trip</button>
        <div className="buddies-visibility"><div><h3>Be visible to travelers</h3><p>{alias ? `Your alias: ${alias}. ` : ""}Only your alias, avatar, mode, destination area, and zone are shared.</p></div><button className={`buddies-toggle ${visible ? "on" : ""}`} type="button" aria-pressed={visible} onClick={() => visible ? void setVisibility(false) : setConsent(true)}>{visible ? <Eye size={17} /> : <EyeOff size={17} />}{visible ? "Visible" : "Off"}</button></div>
        <div className="buddies-invite-notice">{visible && selected ? <><span className="buddies-selected-avatar">{selected.avatar}</span><div><b>{bubbles.some((bubble) => bubble.ref === selected.ref) ? "Travel group" : selected.nickname}</b><span>{bubbles.some((bubble) => bubble.ref === selected.ref) ? "Traveling together" : `${selected.mode}${selected.destinationArea ? ` to ${selected.destinationArea}` : ""}`}</span></div></> : <><UserPlus size={18} /><span>{visible ? "No traveler selected" : "Your trip is hidden"}</span></>}</div>
        <button className="btn btn-primary hamba-start" disabled={!visible || !selected || joining} onClick={() => void join()}><Handshake size={16} />{joining ? "Joining..." : "Join group"}</button>
      </>}
    </section>
    {(incomingInvitations.length > 0 || (active && buddyContacts.length > 0)) && <section className="buddies-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2><UsersRound size={18} />Travel with your buddies</h2>
        <Link className="btn" href="/account/profile/buddies">Manage buddy list</Link>
      </div>
      {incomingInvitations.length > 0 && <div className="mt-4 grid gap-3">
        <h3 className="font-semibold">Invitations for you</h3>
        {incomingInvitations.map((invitation) => <article key={invitation.id} className="rounded-2xl border border-[#e8deed] bg-white p-4">
          <p><b>{invitation.buddy?.name ?? "A buddy"}</b> invited you to join a {invitation.mode} trip.</p>
          {!active && <p className="mt-2 text-sm text-[#6c6072]">Plan your own Travel Together trip before accepting. Your route stays private until you accept.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={Boolean(invitationBusy) || !active} onClick={() => void answerTravelInvitation(invitation.id, "accept")}>
              <UserCheck size={16} />{invitationBusy === invitation.id ? "Please wait..." : "Accept & join"}
            </button>
            <button className="btn" disabled={Boolean(invitationBusy)} onClick={() => void answerTravelInvitation(invitation.id, "decline")}>Decline</button>
            {!active && <button className="btn" onClick={() => setPlanningNewTrip(true)}>Plan my trip</button>}
          </div>
        </article>)}
      </div>}
      {active && buddyContacts.length > 0 && <div className="mt-5 grid gap-3">
        <h3 className="font-semibold">Invite a buddy to your trip</h3>
        {buddyContacts.map((buddy) => {
          const pendingInvite = outgoingInvitations.find((invite) => invite.buddy?.id === buddy.id);
          return <div key={buddy.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e8deed] bg-white p-3">
            <span><b>{buddy.name}</b><small className="ml-2 text-[#756583]">{buddy.kikiId}</small></span>
            {pendingInvite
              ? <span className="text-sm text-[#756583]">Invitation sent</span>
              : <button className="btn" disabled={Boolean(invitationBusy)} onClick={() => void sendTravelInvitation(buddy.id)}>
                <UserPlus size={16} />{invitationBusy === buddy.id ? "Sending..." : "Invite"}
              </button>}
          </div>;
        })}
        <p className="text-sm text-[#756583]">Only accepted buddies can join. Each person must accept; exact trip locations are not shared by these invitations.</p>
      </div>}
    </section>}
    {active && consent && <section className="buddies-consent"><h2>Enable visibility?</h2><p>Your exact location, route, legal name, phone number, and email are never shared. A fresh face check protects your account before you become visible.</p><button className="btn" onClick={() => setConsent(false)}>Cancel</button><button className="btn btn-primary" onClick={() => void setVisibility(true)}>Continue</button></section>}
    {active && pending && <section className="buddies-consent"><h2>Face check</h2><p>{face.state === "preparing" || face.state === "checking" ? "Checking securely..." : face.message}</p><label className="label">Simulation result<select className="input mt-1" value={face.simulationOutcome} onChange={(event) => face.setSimulationOutcome(event.target.value)}><option value="pass">Pass</option><option value="liveness_fail">Liveness fail</option><option value="face_mismatch">Face mismatch</option><option value="timeout">Timeout</option><option value="provider_error">Provider error</option></select></label><button className="btn btn-primary mt-3" disabled={face.state === "preparing" || face.state === "checking"} onClick={() => void gated(pending, pending === "visibility" ? () => setVisibility(true) : pending === "ping" ? join : () => refreshNearby())}>Retry</button></section>}
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}