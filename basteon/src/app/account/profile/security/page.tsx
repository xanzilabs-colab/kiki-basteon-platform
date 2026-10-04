"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SecurityPage() {
  const [pin, setPin] = useState(""); const [message, setMessage] = useState(""); const [pinSet, setPinSet] = useState(false);
  useEffect(() => { const db = createClient(); void (async () => { const { data: { user } } = await db.auth.getUser(); if (!user) return; const { data } = await db.from("profiles").select("safety_pin_set_at").eq("id", user.id).single(); setPinSet(Boolean(data?.safety_pin_set_at)); })(); }, []);
  async function savePin() { if (!/^\d{4,6}$/.test(pin)) return setMessage("Choose a 4 to 6 digit PIN."); const db = createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) return; const { error } = await db.from("profiles").update({ safety_pin_set_at: new Date().toISOString() }).eq("id", user.id); if (error) return setMessage(error.message); setPin(""); setPinSet(true); setMessage("Safety PIN is set."); }
  return <div className="kiki-setting-page"><header><span>MY ACCOUNT</span><h1>Security &amp; PIN Code</h1><p>Use a private safety PIN before changing sensitive settings.</p></header><section><div className="kiki-security-icon"><Lock size={24} /></div><h2>{pinSet ? "Update your safety PIN" : "Set your safety PIN"}</h2><p>A PIN protects sensitive Kiki account actions on this device.</p><label>4 to 6 digit PIN<input className="input" value={pin} inputMode="numeric" maxLength={6} type="password" onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label>{message && <p role="status">{message}</p>}<button className="btn btn-primary" type="button" onClick={() => void savePin()}><ShieldCheck size={16} />Save PIN</button></section></div>;
}
