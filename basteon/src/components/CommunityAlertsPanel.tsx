"use client";

import { useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useAppDialog } from "@/components/AppDialogProvider";
import { AlertTriangle, Check, ChevronRight, MapPin, MapPinned, ThumbsUp, Trash2, X } from "lucide-react";
import { categoryLabel, meetingFetch, type CommunityAlert } from "@/lib/buddies/meeting/client";
import type { ReportLocation } from "./CommunityReportMap";

type Place = { label: string; lat: number; lng: number };
type Props = { alerts: CommunityAlert[]; busy: boolean; initialPoint: { lat: number; lng: number } | null; onBusyChange: (busy: boolean) => void; onAlertsChange: (alerts: CommunityAlert[]) => void; onLocationChange: (point: { lat: number; lng: number } | null) => void; onMessage: (message: string) => void };
const CommunityReportMap = dynamic(() => import("./CommunityReportMap"), {
  ssr: false,
  loading: () => <div className="community-report-map-loading">Opening location map…</div>,
});
const concerns = ["unsafe_area", "poor_lighting", "harassment", "road_hazard"];
const reportCategories = [
  { value: "all", label: "All" },
  { value: "unsafe_area", label: "Unsafe area" },
  { value: "poor_lighting", label: "Lighting" },
  { value: "harassment", label: "Harassment" },
  { value: "road_hazard", label: "Road hazard" },
];
const titleCase = (value: string) => categoryLabel(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
function formatReportAge(value: string) {
  const createdAt = Date.parse(value);
  if (!Number.isFinite(createdAt)) return "time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CommunityAlertsPanel({ alerts, busy, initialPoint, onBusyChange, onAlertsChange, onLocationChange, onMessage }: Props) {
  const { confirm } = useAppDialog();
  const [kind, setKind] = useState("unsafe_area"); const [detail, setDetail] = useState(""); const [address, setAddress] = useState(""); const [selectedAddressLabel, setSelectedAddressLabel] = useState(""); const [suggestions, setSuggestions] = useState<Place[]>([]); const [lookupMessage, setLookupMessage] = useState(""); const [mapOpen, setMapOpen] = useState(false); const [mapSelection, setMapSelection] = useState<ReportLocation>({ point: null, region: null }); const [reportOpen, setReportOpen] = useState(false); const [category, setCategory] = useState("all");
  useEffect(() => {
    if (address.trim().length < 3) { setSuggestions([]); setLookupMessage(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/trips/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: address }),
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error("Address search is temporarily unavailable.");
        return response.json() as Promise<Place[]>;
      }).then((places) => {
        if (controller.signal.aborted) return;
        setSuggestions(places);
        setLookupMessage(places.length ? "" : "No address match found. Choose the exact spot on the map.");
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setLookupMessage(error instanceof Error ? error.message : "Address search failed. Choose the spot on the map.");
        }
      });
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [address]);
  useEffect(() => { if (!reportOpen) return; function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape" && !busy) setReportOpen(false); } window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [busy, reportOpen]);
  function choose(place: Place) {
    setAddress(place.label);
    setSelectedAddressLabel(place.label);
    setSuggestions([]);
    setLookupMessage("Address located. You can adjust the pin on the map.");
    setMapSelection({ point: { lat: place.lat, lng: place.lng }, region: null });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasAddress = address.trim().length >= 3;
    const point = mapSelection.point;
    if ((!hasAddress && !point) || detail.trim().length < 4) return;
    onBusyChange(true);
    try {
      const saved = await meetingFetch<{ id: string; lat: number; lng: number }>("/api/buddies/community-alerts", {
        kind,
        ...(hasAddress ? { address: address.trim() } : {}),
        ...(point ? { lat: point.lat, lng: point.lng } : {}),
        ...(mapSelection.region ? { region: mapSelection.region } : {}),
        detail: detail.trim(),
      });
      onLocationChange({ lat: saved.lat, lng: saved.lng });
      const query = new URLSearchParams({ lat: String(saved.lat), lng: String(saved.lng) });
      const data = await meetingFetch<{ alerts: CommunityAlert[] }>(`/api/buddies/community-alerts?${query}`);
      onAlertsChange(data.alerts);
      onMessage("Your community report is now visible to people nearby.");
      setAddress("");
      setSelectedAddressLabel("");
      setDetail("");
      setMapSelection({ point: null, region: null });
      setMapOpen(false);
      setReportOpen(false);
    } catch (error) { onMessage(error instanceof Error ? error.message : "Could not submit that report."); }
    finally { onBusyChange(false); }
  }
  async function vote(alert: CommunityAlert) { onBusyChange(true); try { const result = await meetingFetch<{ voted: boolean; upvotes: number }>(`/api/buddies/community-alerts/${alert.id}/vote`, {}); onAlertsChange(alerts.map((item) => item.id === alert.id ? { ...item, voted: result.voted, upvotes: result.upvotes } : item)); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not update your confirmation."); } finally { onBusyChange(false); } }
  async function deleteAlert(alert: CommunityAlert) {
    if (!alert.mine || busy || !(await confirm("Delete your community report? This will remove it for everyone.", {
      title: "Delete community report?",
      confirmLabel: "Delete report",
      danger: true,
    }))) return;
    onBusyChange(true);
    try {
      await meetingFetch("/api/buddies/community-alerts", { id: alert.id }, undefined, "DELETE");
      onAlertsChange(alerts.filter((item) => item.id !== alert.id));
      onMessage("Your report was deleted from the community feed.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not delete your report.");
    } finally {
      onBusyChange(false);
    }
  }
  const filteredAlerts = alerts.filter((alert) => category === "all" || alert.kind === category);
  const reportCount = `${filteredAlerts.length} ${filteredAlerts.length === 1 ? "Report" : "Reports"}`;
  return <section id="community-alerts" className="buddies-panel buddy-community-panel safe-alerts-panel">
    <div className="safe-alerts-header">
      <div><h2>Community Feed</h2></div>
      <span className="safe-alert-count">{reportCount}</span>
    </div>
    <div className="safe-report-categories" role="group" aria-label="Filter community reports by category">
      {reportCategories.map((item) => <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
    </div>
    <button type="button" className="safe-report-open" onClick={() => setReportOpen(true)}><span><AlertTriangle size={17} />Report a concern</span><span>Share a local safety update<ChevronRight size={16} /></span></button>
    <div className="buddy-alert-list safe-alert-list">{filteredAlerts.map((alert) => <article key={alert.id} className={`buddy-alert-card safe-alert-card${alert.kind === "poor_lighting" ? " is-lighting" : alert.kind === "harassment" ? " is-rose" : ""}`}>
      <div className="safe-alert-card-heading">
        <span className="safe-alert-meta">
          <span className="safe-alert-kind"><i /><AlertTriangle size={12} />{titleCase(alert.kind)}</span>
          <time dateTime={alert.created_at}>Reported {formatReportAge(alert.created_at)}</time>
        </span>
        <button className={`buddy-upvote ${alert.voted ? "is-voted" : ""}`} type="button" disabled={busy} onClick={() => void vote(alert)} aria-pressed={alert.voted} aria-label={`${alert.upvotes} helpful confirmations`}><ThumbsUp size={14} /><span>{alert.upvotes}</span></button>
      </div>
      <p>{alert.detail ?? "Community report"}</p>
      <div className="safe-alert-card-footer"><MapPin size={14} /><span>{alert.location_label ?? "Nearby location"}{alert.region ? " · Area marked" : ""}</span>
        {alert.mine && <button type="button" className="safe-alert-delete" disabled={busy} onClick={() => void deleteAlert(alert)}><Trash2 size={13} />Delete</button>}
      </div>
    </article>)}</div>
    {filteredAlerts.length === 0 && <div className="safe-alert-empty"><span><Check size={17} /></span><p>{alerts.length === 0 ? "No reports nearby. If you notice a concern, share it with the community." : "No reports in this category. Choose another category to see more."}</p></div>}

    {typeof document !== "undefined" && reportOpen && createPortal(<div className="safe-report-layer">
      <button className="safe-report-backdrop" type="button" aria-label="Close report form" onClick={() => !busy && setReportOpen(false)} />
      <section className="safe-report-sheet" role="dialog" aria-modal="true" aria-labelledby="safe-report-title">
        <div className="safe-report-sheet-grabber" />
        <header><span className="safe-alerts-icon"><AlertTriangle size={19} /></span><div><h2 id="safe-report-title">Report a concern</h2><p>Share a useful, respectful update with nearby people.</p></div><button type="button" aria-label="Close" disabled={busy} onClick={() => setReportOpen(false)}><X size={19} /></button></header>
        <form className="buddy-places buddy-report-form safe-report-form" onSubmit={(event) => void submit(event)}>
          <label className="field">Concern<select value={kind} onChange={(event) => setKind(event.target.value)}>{concerns.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
          <label className="field buddy-report-location">Address or place<input maxLength={300} value={address} onChange={(event) => {
            const nextAddress = event.target.value;
            setAddress(nextAddress);
            if (selectedAddressLabel && nextAddress !== selectedAddressLabel) {
              setMapSelection({ point: null, region: null });
              setSelectedAddressLabel("");
            }
          }} placeholder="Street address, suburb, city (optional with map pin)" autoComplete="street-address" />{suggestions.length > 0 && <div className="buddy-address-results">{suggestions.map((place) => <button type="button" key={`${place.lat}-${place.lng}`} onClick={() => choose(place)}><MapPin size={15} />{place.label}</button>)}</div>}{lookupMessage && <small className="community-report-lookup-message" role="status">{lookupMessage}</small>}</label>
          <div className="community-report-map-actions">
            <button type="button" className="community-report-map-toggle" aria-expanded={mapOpen} onClick={() => setMapOpen((open) => !open)}>
              <MapPinned size={16} />{mapOpen ? "Hide map" : "Choose or adjust location on map"}
            </button>
            {mapSelection.point && <span>{mapSelection.region ? "Area selected" : "Pin selected"} · {mapSelection.point.lat.toFixed(4)}, {mapSelection.point.lng.toFixed(4)}</span>}
          </div>
          {mapOpen && <CommunityReportMap initialPoint={initialPoint} value={mapSelection} onChange={setMapSelection} />}
          <label className="field">What happened?<textarea value={detail} maxLength={500} onChange={(event) => setDetail(event.target.value)} placeholder="A short description helps others understand the concern." /></label>
          <p className="safe-report-privacy">Only share information that may help others stay safe. Do not include personal details.</p>
          <button className="safe-report-submit" type="submit" disabled={busy || (address.trim().length < 3 && !mapSelection.point) || detail.trim().length < 4}><AlertTriangle size={16} />{busy ? "Sharing report…" : "Share local report"}</button>
        </form>
      </section>
    </div>, document.body)}
  </section>;
}