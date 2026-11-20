"use client";

import { useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useAppDialog } from "@/components/AppDialogProvider";
import { Check, LocateFixed, MapPin, MapPinned, Shield, ThumbsUp, Trash2, X } from "lucide-react";
import { categoryLabel, meetingFetch, type CommunityAlert } from "@/lib/buddies/meeting/client";
import type { ReportLocation } from "./CommunityReportMap";
import { AccountFeedCard } from "@/components/account/AccountList";

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
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function CommunityAlertsPanel({ alerts, busy, initialPoint, onBusyChange, onAlertsChange, onLocationChange, onMessage }: Props) {
  const { confirm } = useAppDialog();
  const [kind, setKind] = useState("unsafe_area"); const [detail, setDetail] = useState(""); const [address, setAddress] = useState(""); const [selectedAddressLabel, setSelectedAddressLabel] = useState(""); const [suggestions, setSuggestions] = useState<Place[]>([]); const [lookupMessage, setLookupMessage] = useState(""); const [mapOpen, setMapOpen] = useState(false); const [mapSelection, setMapSelection] = useState<ReportLocation>({ point: null, region: null }); const [reportOpen, setReportOpen] = useState(false); const [category, setCategory] = useState("all");
  useEffect(() => {
    const openComposer = () => setReportOpen(true);
    const focusReport = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      setCategory("all");
      window.setTimeout(() => document.getElementById(`safe-alert-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 40);
    };
    window.addEventListener("kiki:open-report-composer", openComposer);
    window.addEventListener("kiki:focus-community-alert", focusReport);
    return () => {
      window.removeEventListener("kiki:open-report-composer", openComposer);
      window.removeEventListener("kiki:focus-community-alert", focusReport);
    };
  }, []);
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
  useEffect(() => { if (!reportOpen) return; function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape" && !busy) void closeReportForm(); } window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [busy, reportOpen, closeReportForm]);
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
  async function closeReportForm() {
    if (busy) return;
    if ((detail.trim() || address.trim() || mapSelection.point || mapSelection.region) && !(await confirm("Discard this report draft?", {
      title: "Discard draft?",
      confirmLabel: "Discard",
      danger: true,
    }))) return;
    setReportOpen(false);
  }
  const filteredAlerts = alerts.filter((alert) => category === "all" || alert.kind === category);
  const reportCount = `${filteredAlerts.length} ${filteredAlerts.length === 1 ? "report" : "reports"} nearby`;
  return <section id="community-alerts" className="safe-alerts-panel">
    <div className="safe-alerts-header"><span>{reportCount}</span></div>
    {alerts.some((alert) => alert.is_demo) && <div className="safe-demo-notice" role="note"><b>Demo data — not real reports.</b> These fictional samples are shown only for demonstration and do not describe actual incidents.</div>}
    <div className="safe-report-categories" role="group" aria-label="Filter community reports by category">
      {reportCategories.map((item) => <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}
    </div>
    <button type="button" className="safe-report-composer" onClick={() => setReportOpen(true)}>
      <span className="safe-report-composer-avatar"><Shield size={19} aria-hidden="true" /></span>
      <span className="safe-report-composer-placeholder">Share a safety update…</span>
      <span className="safe-report-composer-action">Post</span>
    </button>
    <div className="buddy-alert-list safe-alert-list">{filteredAlerts.map((alert) => <div className="safe-alert-anchor" id={`safe-alert-${alert.id}`} key={alert.id}><AccountFeedCard className={`buddy-alert-card safe-alert-card${alert.is_demo ? " is-demo" : ""}${alert.kind === "poor_lighting" ? " is-lighting" : alert.kind === "harassment" ? " is-rose" : ""}`}>
      <div className="safe-alert-card-heading">
        <span className="safe-alert-author-avatar"><Shield size={17} aria-hidden="true" /></span>
        <span className="safe-alert-author"><b>Anonymous neighbour</b><small>{alert.location_label ?? "Nearby area"} · <time dateTime={alert.created_at}>{formatReportAge(alert.created_at)}</time></small></span>
        <span className={`safe-alert-kind${alert.kind === "poor_lighting" ? " is-lighting" : ""}`}><i /><span className="safe-alert-kind-copy">{titleCase(alert.kind)}</span></span>
      </div>
      <p>{alert.detail ?? "Community report"}</p>
      <button type="button" className="safe-alert-spatial-preview" onClick={() => onLocationChange({ lat: alert.lat, lng: alert.lng })} aria-label={`Locate report near ${alert.location_label || "this area"} on the map`}>
        <span className="safe-alert-spatial-icon"><MapPinned size={18} aria-hidden="true" /></span>
        <span><b>{alert.location_label || "Nearby area"}</b><small>{alert.region ? "Area marked · Tap to view on map" : "Tap to view report on map"}</small></span>
        <LocateFixed size={17} aria-hidden="true" />
      </button>
      <div className="safe-alert-card-footer">
        <button className={`buddy-upvote ${alert.voted ? "is-voted" : ""}`} type="button" disabled={busy || alert.is_demo} onClick={() => void vote(alert)} aria-pressed={alert.voted} aria-label={`${alert.voted ? "Remove confirmation" : "Confirm"}: seen this too, ${alert.upvotes} confirmations`}><ThumbsUp size={16} /><span>Seen this too</span>{alert.upvotes > 0 && <span className="safe-alert-vote-count">{alert.upvotes}</span>}</button>
        {alert.mine && <button type="button" className="safe-alert-delete" disabled={busy} onClick={() => void deleteAlert(alert)} aria-label="Delete your report"><Trash2 size={15} /><span>Delete</span></button>}
        <span className="safe-alert-verification">Unverified</span>
      </div>
    </AccountFeedCard></div>)}</div>
    {filteredAlerts.length === 0 && <div className="safe-alert-empty"><span><Check size={19} /></span><b>{alerts.length === 0 ? "No reports near you" : "No reports in this category"}</b><p>{alerts.length === 0 ? "Share a local update to help others nearby." : "Try another filter to see more."}</p>{alerts.length === 0 && <button type="button" onClick={() => setReportOpen(true)}>Post an update</button>}</div>}

    {typeof document !== "undefined" && reportOpen && createPortal(<div className="safe-report-layer">
      <button className="safe-report-backdrop" type="button" aria-label="Close report form" onClick={() => void closeReportForm()} />
      <section className="safe-report-sheet" role="dialog" aria-modal="true" aria-labelledby="safe-report-title">
        <form id="community-report-form" className="buddy-places buddy-report-form safe-report-form" onSubmit={(event) => void submit(event)}>
          <header className="safe-report-composer-header"><button type="button" aria-label="Close report composer" disabled={busy} onClick={() => void closeReportForm()}><X size={20} /></button><h2 id="safe-report-title">New report</h2><button className="safe-report-submit" type="submit" disabled={busy || (address.trim().length < 3 && !mapSelection.point) || detail.trim().length < 4}>{busy ? "Posting…" : "Post"}</button></header>
          <div className="safe-report-author-row"><span className="safe-report-composer-avatar"><Shield size={18} aria-hidden="true" /></span><span><b>Anonymous neighbour</b><small>Your identity is not shown on reports.</small></span></div>
          <div className="safe-report-category-picker" role="group" aria-label="Report category">
            {concerns.map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{titleCase(value)}</button>)}
          </div>
          <label className="field safe-report-detail">What’s happening?<textarea value={detail} maxLength={300} onChange={(event) => setDetail(event.target.value)} placeholder="Share a short, useful update…" /><small>{detail.length}/300</small></label>
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
              <MapPinned size={16} />{mapOpen ? "Close map picker" : "Pin or draw an area"}
            </button>
            {mapSelection.point && <span>{mapSelection.region ? "Area selected" : "Pin selected"} · {mapSelection.point.lat.toFixed(4)}, {mapSelection.point.lng.toFixed(4)}</span>}
          </div>
          {mapOpen && <CommunityReportMap initialPoint={initialPoint} value={mapSelection} onChange={setMapSelection} />}
          <p className="safe-report-privacy">Don’t include names or personal details.</p>
        </form>
      </section>
    </div>, document.body)}
  </section>;
}