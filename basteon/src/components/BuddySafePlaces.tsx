"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Handshake, LocateFixed, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { BuddyPlaceForm } from "./BuddyPlaceForm";
import { CommunityAlertsPanel } from "./CommunityAlertsPanel";
import { categoryLabel, currentMeetingLocation, directionsUrl, meetingFetch, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";

type BubbleLink = { id: string; member_count: number; expires_at: string };
export function BuddySafePlaces() {
  const [places, setPlaces] = useState<PublicSpot[]>([]); const [alerts, setAlerts] = useState<CommunityAlert[]>([]); const [bubbles, setBubbles] = useState<BubbleLink[]>([]);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null); const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void meetingFetch<{ bubbles: BubbleLink[] }>("/api/buddies/meetings", undefined, controller.signal).then((data) => setBubbles(data.bubbles)).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);
  async function search() {
    setBusy(true); setMessage("");
    try {
      const next = await currentMeetingLocation(); setPoint(next);
      const query = new URLSearchParams({ lat: String(next.lat), lng: String(next.lng) });
      const [spots, reports] = await Promise.all([meetingFetch<{ places: PublicSpot[] }>(`/api/buddies/safe-places?${query}`), meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`)]);
      setPlaces(spots.places); setAlerts(reports.alerts); setSearched(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Search unavailable."); }
    finally { setBusy(false); }
  }
  async function suggest(body: object) {
    setBusy(true); setMessage("");
    try { await meetingFetch("/api/buddies/safe-places", body); setMessage("Spot submitted for review."); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not suggest spot."); return false; }
    finally { setBusy(false); }
  }
  return <div className="buddy-places buddies-page space-y-4">
    <div className="buddies-heading"><div><p className="eyebrow">Buddies</p><h1 className="page-title">Safe spots & meetings</h1></div><Link className="btn" href="/account/buddies"><Handshake size={16} />Buddies</Link></div>
    <section className="buddies-panel"><h2><Handshake size={18} />Your Bubble meetings</h2><div className="mt-3 flex flex-wrap gap-2">{bubbles.map((bubble, index) => <Link className="btn" key={bubble.id} href={`/account/buddies/meeting/${bubble.id}`}>Bubble {index + 1} · {bubble.member_count} Buddies</Link>)}</div>{bubbles.length === 0 && <p className="muted text-sm mt-3">No active Bubble meetings.</p>}</section>
    <section className="buddies-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2><MapPin size={18} />Nearby spots</h2><button className="btn" disabled={busy} onClick={() => void search()}><LocateFixed size={16} />{busy ? "Working..." : "Search near me"}</button></div>
      {searched && places.length === 0 && <p className="muted text-sm mt-3">No reviewed spots nearby.</p>}
      <div className="buddy-nearby-list">{places.map((place) => <article key={place.id} className="buddy-nearby-spot"><div className="buddy-nearby-copy"><h3>{place.name}</h3><p className="buddy-nearby-meta">{categoryLabel(place.category)}{place.open_24h ? " · Open 24 hours" : ""}</p><p className="buddy-nearby-address">{place.address}</p><span className="buddy-reviewed"><ShieldCheck size={13} />Reviewed spot</span></div><a className="btn buddy-directions" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a></article>)}</div>
    </section>
    <CommunityAlertsPanel alerts={alerts} busy={busy} onBusyChange={setBusy} onAlertsChange={setAlerts} onLocationChange={setPoint} onMessage={setMessage} />
    <section className="buddies-panel"><h2 className="mb-3">Suggest a public spot</h2><BuddyPlaceForm busy={busy} onSave={suggest} /></section>
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}