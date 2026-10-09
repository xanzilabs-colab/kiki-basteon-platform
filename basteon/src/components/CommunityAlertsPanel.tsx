"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronRight, LocateFixed, MapPin, ThumbsUp, X } from "lucide-react";
import { categoryLabel, currentMeetingLocation, meetingFetch, type CommunityAlert } from "@/lib/buddies/meeting/client";

type Place = { label: string; lat: number; lng: number };
type Props = { alerts: CommunityAlert[]; busy: boolean; onBusyChange: (busy: boolean) => void; onAlertsChange: (alerts: CommunityAlert[]) => void; onLocationChange: (point: { lat: number; lng: number } | null) => void; onMessage: (message: string) => void };
const concerns = ["unsafe_area", "poor_lighting", "harassment", "road_hazard"];
const reportCategories = [
  { value: "all", label: "All" },
  { value: "unsafe_area", label: "Unsafe area" },
  { value: "poor_lighting", label: "Lighting" },
  { value: "harassment", label: "Harassment" },
  { value: "road_hazard", label: "Road hazard" },
];
const titleCase = (value: string) => categoryLabel(value).replace(/\b\w/g, (letter) => letter.toUpperCase());

export function CommunityAlertsPanel({ alerts, busy, onBusyChange, onAlertsChange, onLocationChange, onMessage }: Props) {
  const [kind, setKind] = useState("unsafe_area"); const [detail, setDetail] = useState(""); const [address, setAddress] = useState(""); const [suggestions, setSuggestions] = useState<Place[]>([]); const [location, setLocation] = useState<Place | null>(null); const [reportOpen, setReportOpen] = useState(false); const [category, setCategory] = useState("all");
  useEffect(() => { if (address.trim().length < 3 || location?.label === address) { setSuggestions([]); return; } const controller = new AbortController(); const timer = window.setTimeout(() => { void fetch("/api/trips/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: address }), signal: controller.signal }).then(async (response) => response.ok ? response.json() as Promise<Place[]> : []).then((places) => { if (!controller.signal.aborted) setSuggestions(places); }).catch(() => undefined); }, 300); return () => { controller.abort(); window.clearTimeout(timer); }; }, [address, location?.label]);
  useEffect(() => { if (!reportOpen) return; function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape" && !busy) setReportOpen(false); } window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [busy, reportOpen]);
  function choose(place: Place) { setLocation(place); setAddress(place.label); setSuggestions([]); onLocationChange({ lat: place.lat, lng: place.lng }); }
  async function useCurrentLocation() { onBusyChange(true); try { const point = await currentMeetingLocation(); choose({ ...point, label: "Current location" }); onMessage("Location added to your report."); } catch (error) { onMessage(error instanceof Error ? error.message : "Location could not be shared."); } finally { onBusyChange(false); } }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!location || detail.trim().length < 4) return; onBusyChange(true); try { await meetingFetch("/api/buddies/community-alerts", { kind, lat: location.lat, lng: location.lng, locationLabel: location.label, detail: detail.trim() }); const query = new URLSearchParams({ lat: String(location.lat), lng: String(location.lng) }); const data = await meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`); onAlertsChange(data.alerts); onMessage("Your community report is now visible to people nearby."); setDetail(""); setReportOpen(false); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not submit that report."); } finally { onBusyChange(false); } }
  async function vote(alert: CommunityAlert) { onBusyChange(true); try { const result = await meetingFetch<{ voted: boolean; upvotes: number }>(`/api/buddies/community-alerts/${alert.id}/vote`, {}); onAlertsChange(alerts.map((item) => item.id === alert.id ? { ...item, voted: result.voted, upvotes: result.upvotes } : item)); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not update your confirmation."); } finally { onBusyChange(false); } }
  const activeAlerts = alerts.filter((alert) => Date.parse(alert.expires_at) > Date.now());
  const filteredAlerts = activeAlerts.filter((alert) => category === "all" || alert.kind === category);
  return <section id="community-alerts" className="buddies-panel buddy-community-panel safe-alerts-panel">
    <div className="safe-alerts-header">
      <span className="safe-alerts-icon"><AlertTriangle size={19} /></span>
      <div><h2>Community feed</h2><p>Local reports shared by people nearby.</p></div>
      <span className="safe-alert-count">{activeAlerts.length} active</span>
    </div>
    <div className="safe-report-categories" role="group" aria-label="Filter community reports by category">
      {reportCategories.map((item) => <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
    </div>
    <button type="button" className="safe-report-open" onClick={() => setReportOpen(true)}><span><AlertTriangle size={17} />Report a concern</span><span>Share a local safety update<ChevronRight size={16} /></span></button>
    <div className="buddy-alert-list safe-alert-list">{filteredAlerts.map((alert) => <article key={alert.id} className={`buddy-alert-card safe-alert-card${alert.kind === "harassment" ? " is-rose" : ""}`}>
      <div className="safe-alert-card-heading"><span className="safe-alert-kind"><i><AlertTriangle size={18} /></i><span><strong>{titleCase(alert.kind)}</strong><small>Expires {new Date(alert.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></span><button className={`buddy-upvote ${alert.voted ? "is-voted" : ""}`} type="button" disabled={busy} onClick={() => void vote(alert)} aria-pressed={alert.voted} aria-label={`${alert.upvotes} helpful confirmations`}><ThumbsUp size={16} /><span>{alert.upvotes}</span></button></div>
      <p>{alert.detail ?? "Community report"}</p>
      <div className="safe-alert-card-footer"><span><MapPin size={14} />{alert.location_label ?? "Nearby location"}</span></div>
    </article>)}</div>
    {filteredAlerts.length === 0 && <div className="safe-alert-empty"><span><Check size={17} /></span><p>{activeAlerts.length === 0 ? "No active reports nearby. If you notice a concern, share it with the community." : "No reports in this category. Choose another category to see more."}</p></div>}

    {typeof document !== "undefined" && reportOpen && createPortal(<div className="safe-report-layer">
      <button className="safe-report-backdrop" type="button" aria-label="Close report form" onClick={() => !busy && setReportOpen(false)} />
      <section className="safe-report-sheet" role="dialog" aria-modal="true" aria-labelledby="safe-report-title">
        <div className="safe-report-sheet-grabber" />
        <header><span className="safe-alerts-icon"><AlertTriangle size={19} /></span><div><h2 id="safe-report-title">Report a concern</h2><p>Share a useful, respectful update with nearby people.</p></div><button type="button" aria-label="Close" disabled={busy} onClick={() => setReportOpen(false)}><X size={19} /></button></header>
        <form className="buddy-places buddy-report-form safe-report-form" onSubmit={(event) => void submit(event)}>
          <label className="field">Concern<select value={kind} onChange={(event) => setKind(event.target.value)}>{concerns.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
          <label className="field buddy-report-location">Location<div className="buddy-location-row"><input value={address} onChange={(event) => { setAddress(event.target.value); setLocation(null); }} placeholder="Search an address" autoComplete="off" /><button type="button" className="btn" disabled={busy} onClick={() => void useCurrentLocation()}><LocateFixed size={16} />Use mine</button></div>{suggestions.length > 0 && <div className="buddy-address-results">{suggestions.map((place) => <button type="button" key={`${place.lat}-${place.lng}`} onClick={() => choose(place)}><MapPin size={15} />{place.label}</button>)}</div>}{location && <small className="buddy-location-selected"><MapPin size={14} />{location.label}</small>}</label>
          <label className="field">What happened?<textarea value={detail} maxLength={500} onChange={(event) => setDetail(event.target.value)} placeholder="A short description helps others understand the concern." /></label>
          <p className="safe-report-privacy">Only share information that may help others stay safe. Do not include personal details.</p>
          <button className="safe-report-submit" type="submit" disabled={busy || !location || detail.trim().length < 4}><AlertTriangle size={16} />{busy ? "Sharing report…" : "Share local report"}</button>
        </form>
      </section>
    </div>, document.body)}
  </section>;
}