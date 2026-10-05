"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { BuddyPlaceForm } from "./BuddyPlaceForm";
import { categoryLabel, meetingFetch, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";

type AdminSpot = PublicSpot & { review_status: string; active: boolean; reverify_by: string | null };
type AdminView = { places: AdminSpot[]; alerts: CommunityAlert[] };

export function AdminBuddyPlaces() {
  const [view, setView] = useState<AdminView | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void meetingFetch<AdminView>("/api/admin/buddy-places", undefined, controller.signal).then(setView).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);
  async function refresh() {
    setBusy(true); setMessage("");
    try { setView(await meetingFetch<AdminView>("/api/admin/buddy-places")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Review queue unavailable."); }
    finally { setBusy(false); }
  }
  async function save(body: object): Promise<boolean> {
    setBusy(true); setMessage("");
    try { await meetingFetch("/api/admin/buddy-places", body); setView(await meetingFetch<AdminView>("/api/admin/buddy-places")); setMessage("Saved."); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save review."); return false; }
    finally { setBusy(false); }
  }
  function review(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void save({ action: "review", id, status: fields.get("status"), quality: Number(fields.get("quality")), active: fields.get("active") === "on", open24h: fields.get("open24h") === "on" });
  }
  return <div className="buddy-places max-w-[1280px] space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4"><h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={20} />Buddy safe spots</h1><button className="btn" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button></header>
    <section className="border-b border-[var(--line)] pb-6"><h2 className="mb-4 text-base font-semibold">Create a reviewed public spot</h2><BuddyPlaceForm admin busy={busy} onSave={save} /></section>
    <section><h2 className="text-base font-semibold">Spot reviews</h2>{!view && !message && <p className="muted text-sm mt-3">Loading reviews...</p>}{view?.places.length === 0 && <p className="muted text-sm mt-3">No safe spots yet.</p>}<div className="divide-y divide-[var(--line)]">{view?.places.map((place) => <form key={`${place.id}-${place.review_status}-${place.active}-${place.quality}-${place.open_24h}`} onSubmit={(event) => review(event, place.id)} className="py-4 space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><h3 className="font-semibold">{place.name}</h3><p className="muted text-xs capitalize">{categoryLabel(place.category)} · {place.review_status}</p><p className="muted text-xs">{place.address} · {place.lat.toFixed(5)}, {place.lng.toFixed(5)}</p>{place.reverify_by && <p className="muted text-xs">Review due {place.reverify_by}</p>}</div></div><div className="flex flex-wrap items-end gap-3"><label className="field">Review status<select name="status" defaultValue={place.review_status}>{["pending", "approved", "rejected"].map((status) => <option key={status}>{status}</option>)}</select></label><label className="field">Quality<select name="quality" defaultValue={place.quality}>{[1, 2, 3, 4, 5].map((quality) => <option key={quality}>{quality}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={place.active} />Listed</label><label className="flex items-center gap-2 text-sm"><input name="open24h" type="checkbox" defaultChecked={place.open_24h} />Open 24 hours</label><button className="btn" disabled={busy}><Check size={16} />Save review</button></div></form>)}</div></section>
    <section className="border-t border-[var(--line)] pt-5"><h2 className="text-base font-semibold">Active community alerts</h2>{view?.alerts.length === 0 && <p className="muted text-sm mt-3">No active community reports.</p>}<div className="divide-y divide-[var(--line)]">{view?.alerts.map((alert) => <article key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><h3 className="capitalize font-semibold text-sm">{categoryLabel(alert.kind)}</h3><p className="muted text-xs">{alert.lat.toFixed(3)}, {alert.lng.toFixed(3)} · expires {new Date(alert.expires_at).toLocaleString()}</p></div><button className="btn" disabled={busy} onClick={() => void save({ action: "resolve", id: alert.id })}><Check size={16} />Resolve</button></article>)}</div></section>
    {message && <p className="buddies-message" role="status">{message}</p>}
  </div>;
}