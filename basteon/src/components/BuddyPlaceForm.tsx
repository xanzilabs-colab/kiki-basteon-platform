"use client";

import "./buddyPlaces.css";

import { useState, type FormEvent } from "react";
import { LocateFixed, Plus } from "lucide-react";
import { MEET_CATEGORIES } from "@/lib/buddies/meeting/types";
import { categoryLabel, currentMeetingLocation } from "@/lib/buddies/meeting/client";

export function BuddyPlaceForm({ admin = false, busy, onSave }: { admin?: boolean; busy: boolean; onSave: (body: object) => Promise<boolean> }) {
  const [locating, setLocating] = useState(false);
  const [lat, setLat] = useState(""); const [lng, setLng] = useState(""); const [error, setError] = useState("");
  async function locate() {
    setLocating(true); setError("");
    try { const point = await currentMeetingLocation(); setLat(String(point.lat)); setLng(String(point.lng)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Location unavailable."); }
    finally { setLocating(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const saved = await onSave({ name: String(fields.get("name")), category: String(fields.get("category")), address: String(fields.get("address")) || null, lat: Number(lat), lng: Number(lng), ...(admin ? { action: "create", quality: Number(fields.get("quality")), open24h: fields.get("open24h") === "on" } : {}) });
    if (saved) { form.reset(); setLat(""); setLng(""); }
  }
  return <form className="buddy-places space-y-3" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-3 sm:grid-cols-2"><label className="field">Place name<input name="name" required minLength={2} maxLength={200} /></label><label className="field">Category<select name="category">{MEET_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label></div>
    <label className="field">Public address<input name="address" maxLength={300} /></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="field">Latitude<input type="number" step="any" required min={-90} max={90} value={lat} onChange={(event) => setLat(event.target.value)} /></label><label className="field">Longitude<input type="number" step="any" required min={-180} max={180} value={lng} onChange={(event) => setLng(event.target.value)} /></label></div>
    {admin && <div className="flex flex-wrap items-end gap-4"><label className="field">Quality<select name="quality" defaultValue="3">{[1, 2, 3, 4, 5].map((quality) => <option key={quality}>{quality}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="open24h" />Open 24 hours</label></div>}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={busy || locating} onClick={() => void locate()}><LocateFixed size={16} />{locating ? "Locating..." : "Use current location"}</button><button className="btn btn-primary" disabled={busy || locating}><Plus size={16} />{admin ? "Create spot" : "Suggest spot"}</button></div>
    {error && <p role="alert" className="buddies-message">{error}</p>}
  </form>;
}