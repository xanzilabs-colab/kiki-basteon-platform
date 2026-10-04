"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Details = { full_name: string; phone: string; home_address: string; emergency_contact_name: string; emergency_contact_phone: string };
const empty: Details = { full_name: "", phone: "", home_address: "", emergency_contact_name: "", emergency_contact_phone: "" };

export default function ProfileInfoPage() {
  const [details, setDetails] = useState<Details>(empty); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { const db = createClient(); void (async () => { const { data: { user } } = await db.auth.getUser(); if (!user) return; const { data } = await db.from("profiles").select("full_name,phone,home_address,emergency_contact_name,emergency_contact_phone").eq("id", user.id).single(); setDetails({ ...empty, ...data }); })(); }, []);
  function field(key: keyof Details) { return { value: details[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDetails((current) => ({ ...current, [key]: event.target.value })) }; }
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); const db = createClient(); const { data: { user } } = await db.auth.getUser(); if (user) { const { error } = await db.from("profiles").update({ ...details, full_name: details.full_name.trim(), phone: details.phone.trim() || null, home_address: details.home_address.trim() || null, emergency_contact_name: details.emergency_contact_name.trim() || null, emergency_contact_phone: details.emergency_contact_phone.trim() || null }).eq("id", user.id); setMessage(error?.message ?? "Profile details saved."); } setSaving(false); }
  return <form className="kiki-setting-page" onSubmit={save}><header><span>MY ACCOUNT</span><h1>Personal details</h1><p>Keep your identity and emergency contact information current.</p></header><section><label>Full name<input className="input" required {...field("full_name")} /></label><label>Mobile number<input className="input" type="tel" {...field("phone")} /></label><label>Home address<textarea className="input" {...field("home_address")} /></label><label>Emergency contact name<input className="input" {...field("emergency_contact_name")} /></label><label>Emergency contact phone<input className="input" type="tel" {...field("emergency_contact_phone")} /></label>{message && <p role="status">{message}</p>}<button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save details"}</button></section></form>;
}
