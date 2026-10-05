"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Handshake, LocateFixed, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { BuddyPlaceForm } from "./BuddyPlaceForm";
import { categoryLabel, currentMeetingLocation, directionsUrl, meetingFetch, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";

type BubbleLink = { id: string; member_count: number; expires_at: string };
export function BuddySafePlaces() {
  const [places, setPlaces] = useState<PublicSpot[]>([]); const [alerts, setAlerts] = useState<CommunityAlert[]>([]); const [bubbles, setBubbles] = useState<BubbleLink[]>([]);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null); const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [kind, setKind] = useState("unsafe_area");
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
  async function report() {
    setBusy(true); setMessage("");
    try {
      const current = await currentMeetingLocation(); setPoint(current);
      await meetingFetch("/api/buddies/community-alerts", { ...current, kind });
      const query = new URLSearchParams({ lat: String(current.lat), lng: String(current.lng) });
      setAlerts((await meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`)).alerts);
      setMessage("Community alert reported.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not report alert."); }
    finally { setBusy(false); }
  }
  return <div className="buddy-places buddies-page space-y-4">
    <div className="buddies-heading"><div><p className="eyebrow">Buddies</p><h1 className="page-title">Safe spots & meetings</h1></div><Link className="btn" href="/account/buddies"><Handshake size={16} />Buddies</Link></div>
    <section className="buddies-panel"><h2><Handshake size={18} />Your Bubble meetings</h2><div className="mt-3 flex flex-wrap gap-2">{bubbles.map((bubble, index) => <Link className="btn" key={bubble.id} href={`/account/buddies/meeting/${bubble.id}`}>Bubble {index + 1} · {bubble.member_count} Buddies</Link>)}</div>{bubbles.length === 0 && <p className="muted text-sm mt-3">No active Bubble meetings.</p>}</section>
    <section className="buddies-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2><MapPin size={18} />Nearby spots</h2><button className="btn" disabled={busy} onClick={() => void search()}><LocateFixed size={16} />{busy ? "Working..." : "Search near me"}</button></div>
      {searched && places.length === 0 && <p className="muted text-sm mt-3">No reviewed spots nearby.</p>}
      <div className="mt-3 divide-y divide-[var(--line)]">{places.map((place) => <article key={place.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0 break-words"><h3 className="font-semibold">{place.name}</h3><p className="muted text-xs capitalize">{categoryLabel(place.category)}{place.open_24h ? " · Open 24 hours" : ""}</p><p className="muted text-xs">{place.address}</p><span className="inline-flex items-center gap-1 text-xs"><ShieldCheck size={13} />Reviewed</span></div><a className="btn" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a></article>)}</div>
    </section>
    <section id="community-alerts" className="buddies-panel"><h2><AlertTriangle size={18} />Community alerts</h2><div className="mt-3 flex flex-wrap items-end gap-3"><label className="field">Concern<select value={kind} onChange={(event) => setKind(event.target.value)}>{["unsafe_area", "poor_lighting", "harassment", "road_hazard"].map((value) => <option key={value} value={value}>{categoryLabel(value)}</option>)}</select></label><button className="btn" disabled={busy} onClick={() => void report()}><AlertTriangle size={16} />Report here</button></div>{point && <p className="muted text-xs mt-3">Near {point.lat.toFixed(3)}, {point.lng.toFixed(3)}</p>}<div className="mt-3 divide-y divide-[var(--line)]">{alerts.filter((alert) => Date.parse(alert.expires_at) > Date.now()).map((alert) => <article key={alert.id} className="flex flex-wrap justify-between items-center gap-3 py-3"><div><b className="capitalize text-sm">{categoryLabel(alert.kind)}</b><p className="muted text-xs">Community report · expires {new Date(alert.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p><p className="muted text-xs">{alert.lat.toFixed(3)}, {alert.lng.toFixed(3)}</p></div><a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${alert.lat},${alert.lng}`} target="_blank" rel="noreferrer"><MapPin size={15} />View area</a></article>)}</div>{searched && alerts.length === 0 && <p className="muted text-sm mt-3">No active reports nearby.</p>}</section>
    <section className="buddies-panel"><h2 className="mb-3">Suggest a public spot</h2><BuddyPlaceForm busy={busy} onSave={suggest} /></section>
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}