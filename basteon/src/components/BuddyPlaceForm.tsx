"use client";

import "./buddyPlaces.css";

import { type FormEvent } from "react";
import { Plus } from "lucide-react";
import { MEET_CATEGORIES } from "@/lib/buddies/meeting/types";
import { categoryLabel } from "@/lib/buddies/meeting/client";

export function BuddyPlaceForm({ admin = false, busy, onSave }: { admin?: boolean; busy: boolean; onSave: (body: object) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const saved = await onSave({ name: String(fields.get("name")), category: String(fields.get("category")), address: String(fields.get("address")), ...(admin ? { action: "create", quality: Number(fields.get("quality")), open24h: fields.get("open24h") === "on" } : {}) });
    if (saved) form.reset();
  }
  return <form className="buddy-places space-y-3" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-3 sm:grid-cols-2"><label className="field">Place name<input name="name" required minLength={2} maxLength={200} /></label><label className="field">Category<select name="category">{MEET_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label></div>
    <label className="field">Public address<input name="address" required minLength={3} maxLength={300} placeholder="Street address, suburb, city" /><span className="mt-1 block text-[11px] font-normal text-[var(--muted)]">We’ll locate the place from its address.</span></label>
    {admin && <div className="flex flex-wrap items-end gap-4"><label className="field">Quality<select name="quality" defaultValue="3">{[1, 2, 3, 4, 5].map((quality) => <option key={quality}>{quality}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="open24h" />Open 24 hours</label></div>}
    <button className="btn btn-primary" disabled={busy}><Plus size={16} />{admin ? "Create spot" : "Suggest spot"}</button>
  </form>;
}