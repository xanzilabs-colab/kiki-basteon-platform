"use client";

import Link from "next/link";
import { BatteryCharging, ChevronRight, MapPin, Radio, Settings, Shield, ShieldCheck, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const [{ data }, { count: deviceCount }] = await Promise.all([supabase.from("profiles").select("*").eq("id", user.id).single(), supabase.from("devices").select("id", { count: "exact", head: true })]); setProfile(data as Profile | null); setCount(deviceCount ?? 0); })(); }, []);
  const complete = Boolean(profile?.full_name?.trim() && profile.phone?.trim());
  return <div className="kiki-reference-page">
    <div className="kiki-reference-title"><div><span>MY SAFETY</span><h1>Account overview</h1></div><Link href={complete ? "/account/devices/link" : "/account/profile"} className="kiki-add-device">+ Add Device</Link></div>
    <section className="kiki-reference-card"><div className="kiki-card-heading"><div className="kiki-card-icon"><ShieldCheck size={20} /></div><div><h2>Devices</h2><p>Active hardware connected</p></div><b className="kiki-device-count"><Radio size={14} />{count ?? 0} Linked</b></div><div className="kiki-device-summary"><span className="kiki-device-art"><Radio size={20} /></span><div><h3>{count ? "Your Kiki device" : "No Kiki device linked"}</h3><p>{count ? <><span><BatteryCharging size={13} />Ready</span> · Protection available</> : "Link a Kiki safety device."}</p></div><ChevronRight size={20} /></div><Link href={complete ? "/account/devices" : "/account/profile"} className="kiki-solid-button"><Settings size={16} />Manage Devices</Link></section>
    <section className="kiki-reference-card"><div className="kiki-card-heading"><div className="kiki-card-icon kiki-card-icon-profile"><UserCheck size={20} /></div><div><h2>Profile &amp; Responders</h2><p>Emergency access permissions</p></div></div><p className="kiki-notice">Your contact information and live GPS location are made available to <strong>authorised responders</strong> only when your device triggers an alert.</p><div className="kiki-stat-grid"><div><span><Shield size={16} /></span><p>Responders</p><b>{profile?.emergency_contact_name ? "1 Active Contact" : "Add a contact"}</b></div><div><span><MapPin size={16} /></span><p>GPS Sharing</p><b>On Alert Only</b></div></div><div className="kiki-button-pair"><Link href="/account/profile">Manage Profile</Link><Link href="/account/guardians">Guardian Circle</Link></div></section>
    <section className="kiki-readiness"><div><span>SYSTEM READINESS</span><h2>{complete && count ? "Safety Score: 100%" : "Finish your safety setup"}</h2><p>{complete && count ? "Your profile and connected safety hardware are ready." : "Add your details and link a device to complete setup."}</p></div><span className="kiki-readiness-mark"><ShieldCheck size={24} /></span></section>
  </div>;
}
