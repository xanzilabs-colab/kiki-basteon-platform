"use client";

import { Check, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ringtone = { id: string; name: string; storage_path: string };
export default function RingtonesPage() {
  const [ringtones, setRingtones] = useState<Ringtone[]>([]); const [selected, setSelected] = useState<string | null>(null); const [message, setMessage] = useState("");
  useEffect(() => { const db = createClient(); void (async () => { const { data: { user } } = await db.auth.getUser(); if (!user) return; const [{ data: catalog }, { data: profile }] = await Promise.all([db.from("ringtones").select("id,name,storage_path").eq("is_stock", true).order("name"), db.from("profiles").select("ringtone_id").eq("id", user.id).single()]); setRingtones(catalog ?? []); setSelected(profile?.ringtone_id ?? null); })(); }, []);
  async function choose(ringtone: Ringtone) { const db = createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) return; const { error } = await db.from("profiles").update({ ringtone_id: ringtone.id, ringtone_path: null }).eq("id", user.id); if (error) return setMessage(error.message); setSelected(ringtone.id); setMessage(`${ringtone.name} selected for your Safety Call.`); }
  async function preview(ringtone: Ringtone) { const db = createClient(); const { data } = await db.storage.from("kiki-ringtones").createSignedUrl(ringtone.storage_path, 60); if (!data?.signedUrl) return setMessage("Preview could not be loaded."); try { await new Audio(data.signedUrl).play(); } catch { setMessage("Preview could not play in this browser."); } }
  return <div className="kiki-setting-page"><header><span>MY ACCOUNT</span><h1>Ringtones</h1><p>Choose the sound used for incoming Kiki Safety Calls.</p></header><section><div className="kiki-ringtone-list">{ringtones.map((ringtone) => <div key={ringtone.id}><b>{ringtone.name}</b><span><button type="button" title={`Preview ${ringtone.name}`} onClick={() => void preview(ringtone)}><Play size={15} /></button><button type="button" className={selected === ringtone.id ? "is-selected" : ""} onClick={() => void choose(ringtone)}>{selected === ringtone.id ? <><Check size={15} />Selected</> : "Select"}</button></span></div>)}</div>{message && <p role="status">{message}</p>}</section></div>;
}
