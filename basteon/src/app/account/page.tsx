"use client";

import Link from "next/link";
import { BatteryCharging, ChevronRight, History, MapPin, Navigation, Radio, Settings, Shield, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

type TripActivity = { id: string; destination_label: string; mode: string; status: string; created_at: string; ended_at: string | null };
type BuddyActivity = { active: boolean; visible?: boolean; alias?: string; expiresAt?: string };

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [trips, setTrips] = useState<{ trip: TripActivity | null; recent: TripActivity[] } | null>(null);
  const [tripError, setTripError] = useState(false);
  const [buddy, setBuddy] = useState<BuddyActivity | null>(null);
  const [buddyError, setBuddyError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/trips").then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { if (!cancelled) setTrips({ trip: data.trip ?? null, recent: data.recent ?? [] }); }).catch(() => { if (!cancelled) setTripError(true); });
    void fetch("/api/buddies/trips").then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { if (!cancelled) setBuddy(data); }).catch(() => { if (!cancelled) setBuddyError(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { const supabase = createClient(); void (async () => { const { data: { user } } = await supabase.auth.getUser(); if (!user) return; const [{ data }, { count: deviceCount }] = await Promise.all([supabase.from("profiles").select("*").eq("id", user.id).single(), supabase.from("devices").select("id", { count: "exact", head: true })]); setProfile(data as Profile | null); setCount(deviceCount ?? 0); })(); }, []);
  const complete = Boolean(profile?.full_name?.trim() && profile.phone?.trim());
  return <div className="kiki-reference-page">
    <div className="kiki-reference-title"><div><span>MY SAFETY</span><h1>Account overview</h1></div><Link href={complete ? "/account/devices/link" : "/account/profile"} className="kiki-add-device">+ Add Device</Link></div>
    <section className="kiki-reference-card"><div className="kiki-card-heading"><div className="kiki-card-icon"><ShieldCheck size={20} /></div><div><h2>Devices</h2><p>Active hardware connected</p></div><b className="kiki-device-count"><Radio size={14} />{count ?? 0} Linked</b></div><div className="kiki-device-summary"><span className="kiki-device-art"><Radio size={20} /></span><div><h3>{count ? "Your Kiki device" : "No Kiki device linked"}</h3><p>{count ? <><span><BatteryCharging size={13} />Ready</span> · Protection available</> : "Link a Kiki safety device."}</p></div><ChevronRight size={20} /></div><Link href={complete ? "/account/devices" : "/account/profile"} className="kiki-solid-button"><Settings size={16} />Manage Devices</Link></section>
    <section className="kiki-reference-card"><div className="kiki-card-heading"><div className="kiki-card-icon kiki-card-icon-profile"><UserCheck size={20} /></div><div><h2>Profile &amp; Responders</h2><p>Emergency access permissions</p></div></div><p className="kiki-notice">Your contact information and live GPS location are made available to <strong>authorised responders</strong> only when your device triggers an alert.</p><div className="kiki-stat-grid"><div><span><Shield size={16} /></span><p>Responders</p><b>{profile?.emergency_contact_name ? "1 Active Contact" : "Add a contact"}</b></div><div><span><MapPin size={16} /></span><p>GPS Sharing</p><b>On Alert Only</b></div></div><div className="kiki-button-pair"><Link href="/account/profile">Manage Profile</Link><Link href="/account/guardians">Guardian Circle</Link></div></section>
    <section className="kiki-reference-card kiki-activity-widget"><div className="kiki-card-heading"><div className="kiki-card-icon"><Navigation size={20} /></div><div><h2>Current trip</h2><p>Route Watch activity</p></div></div>{trips?.trip ? <Link className="kiki-activity-row" href="/account/trips"><Navigation size={18} /><div><b>{trips.trip.destination_label}</b><p>{trips.trip.mode} · {trips.trip.status}</p></div><ChevronRight size={18} /></Link> : <p className="kiki-activity-empty">{tripError ? "Trip activity is unavailable right now." : trips ? "No active trip." : "Loading trip activity..."}</p>}<Link href="/account/trips" className="kiki-solid-button"><Navigation size={16} />{trips?.trip ? "View active trip" : "Plan a safe trip"}</Link></section>
    <section className="kiki-reference-card kiki-activity-widget"><div className="kiki-card-heading"><div className="kiki-card-icon"><History size={20} /></div><div><h2>Recent trips</h2><p>Your latest destinations</p></div></div>{trips && trips.recent.length > 0 ? <div className="kiki-activity-list">{trips.recent.slice(0, 3).map((trip) => <Link className="kiki-activity-row" href="/account/trips" key={trip.id}><MapPin size={18} /><div><b>{trip.destination_label}</b><p>{trip.status === "arrived" ? "Arrived safely" : "Cancelled"} · {new Date(trip.ended_at ?? trip.created_at).toLocaleDateString()}</p></div><ChevronRight size={16} /></Link>)}</div> : <p className="kiki-activity-empty">{tripError ? "Recent trips are unavailable right now." : trips ? "No completed trips yet." : "Loading recent trips..."}</p>}</section>
    <section className="kiki-reference-card kiki-activity-widget"><div className="kiki-card-heading"><div className="kiki-card-icon kiki-card-icon-buddy"><UsersRound size={20} /></div><div><h2>Buddy activity</h2><p>Your private travel presence</p></div></div>{buddy?.active ? <Link className="kiki-activity-row" href="/account/buddies"><UsersRound size={18} /><div><b>{buddy.alias ?? "Your Buddy trip"}</b><p>{buddy.visible ? "Visible in approximate zones" : "Hidden from nearby Buddies"}</p></div><ChevronRight size={18} /></Link> : <p className="kiki-activity-empty">{buddyError ? "Buddy activity is unavailable right now." : buddy ? "No active Buddy trip." : "Loading Buddy activity..."}</p>}<Link href="/account/buddies" className="kiki-solid-button"><UsersRound size={16} />{buddy?.active ? "Manage Buddy trip" : "Plan a Buddy trip"}</Link></section>
    <section className="kiki-readiness"><div><span>SYSTEM READINESS</span><h2>{complete && count ? "Safety Score: 100%" : "Finish your safety setup"}</h2><p>{complete && count ? "Your profile and connected safety hardware are ready." : "Add your details and link a device to complete setup."}</p></div><span className="kiki-readiness-mark"><ShieldCheck size={24} /></span></section>
  </div>;
}
