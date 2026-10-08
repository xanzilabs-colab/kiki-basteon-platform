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
  const readiness = complete && (count ?? 0) > 0;
  const stepsDone = [complete, (count ?? 0) > 0, Boolean(trips?.trip ?? buddy?.active)];
  const progress = Math.round((stepsDone.filter(Boolean).length / 3) * 100);
  const ringOffset = 226 - (226 * progress) / 100;
  return <div className={`kiki-overview ${readiness ? "is-ready" : ""}`}>
    <div className="kiki-overview-head">
      <div>
        <span>MY SAFETY</span>
        <h1>Account overview</h1>
      </div>
      <Link href={complete ? "/account/devices/link" : "/account/profile"} className="kiki-overview-add">+ Add device</Link>
    </div>

    <section className="kiki-overview-hero">
      <div className="kiki-overview-ring">
        <svg viewBox="0 0 84 84" aria-hidden="true">
          <circle className="ring-track" cx="42" cy="42" r="36" />
          <circle className="ring-progress" cx="42" cy="42" r="36" style={{ strokeDasharray: 226, strokeDashoffset: ringOffset }} />
        </svg>
        <strong>{progress}<small>%</small></strong>
      </div>
      <div className="kiki-overview-hero-copy">
        <small>LIVE READINESS</small>
        <h2>{readiness ? "System ready" : "Setup in progress"}</h2>
        <p>{readiness ? "Live GPS and responder handoff are ready if you need help." : "Finish profile and link a device to unlock full protection."}</p>
      </div>
    </section>

    <div className="kiki-overview-steps">
      <Link href="/account/profile" className={`kiki-overview-step ${stepsDone[0] ? "done" : ""}`}><span>1</span>Profile</Link>
      <Link href="/account/devices" className={`kiki-overview-step ${stepsDone[1] ? "done" : ""}`}><span>2</span>Device</Link>
      <Link href="/account/trips" className={`kiki-overview-step ${stepsDone[2] ? "done" : ""}`}><span>3</span>Trip</Link>
    </div>

    <div className="kiki-overview-tiles">
      <Link href="/account/trips" className="kiki-overview-tile">
        <span><Navigation size={19} /></span>
        <b>Plan safe trip</b>
        <small>{trips?.trip ? "Trip active" : "Route Watch inactive"}</small>
      </Link>
      <Link href="/account/devices" className="kiki-overview-tile">
        <span><Radio size={19} /></span>
        <b>Kiki hardware</b>
        <small>{count ?? 0} linked</small>
      </Link>
      <Link href="/account/guardians" className="kiki-overview-tile">
        <span><Shield size={19} /></span>
        <b>Responders</b>
        <small>{profile?.emergency_contact_name ? "1 contact active" : "Add your first contact"}</small>
      </Link>
      <Link href="/account/buddies" className="kiki-overview-tile">
        <span><UsersRound size={19} /></span>
        <b>Buddy watch</b>
        <small>{buddy?.active ? "Trip visible to Buddy" : "No Buddy trip active"}</small>
      </Link>
    </div>

    <section className="kiki-overview-card">
      <div className="kiki-overview-card-head"><h3>Current activity</h3><Link href="/account/trips">Open trips</Link></div>
      {trips?.trip ? <Link className="kiki-overview-row" href="/account/trips"><Navigation size={17} /><div><b>{trips.trip.destination_label}</b><p>{trips.trip.mode} · {trips.trip.status}</p></div><ChevronRight size={16} /></Link> : <p className="kiki-overview-empty">{tripError ? "Trip activity is unavailable right now." : trips ? "No active trip." : "Loading trip activity..."}</p>}
      {buddy?.active ? <Link className="kiki-overview-row" href="/account/buddies"><UsersRound size={17} /><div><b>{buddy.alias ?? "Buddy trip active"}</b><p>{buddy.visible ? "Visible in approximate zones" : "Hidden from nearby Buddies"}</p></div><ChevronRight size={16} /></Link> : <p className="kiki-overview-empty">{buddyError ? "Buddy activity is unavailable right now." : buddy ? "No active Buddy trip." : "Loading Buddy activity..."}</p>}
    </section>

    <section className="kiki-overview-card">
      <div className="kiki-overview-card-head"><h3>Recent trips</h3><Link href="/account/trips/history">History</Link></div>
      {trips && trips.recent.length > 0 ? <div className="kiki-overview-list">{trips.recent.slice(0, 3).map((trip) => <Link className="kiki-overview-row" href="/account/trips/history" key={trip.id}><MapPin size={17} /><div><b>{trip.destination_label}</b><p>{trip.status === "arrived" ? "Arrived safely" : "Cancelled"} · {new Date(trip.ended_at ?? trip.created_at).toLocaleDateString()}</p></div><ChevronRight size={16} /></Link>)}</div> : <p className="kiki-overview-empty">{tripError ? "Recent trips are unavailable right now." : trips ? "No completed trips yet." : "Loading recent trips..."}</p>}
    </section>

    <section className="kiki-overview-readiness">
      <div><span>SYSTEM READINESS</span><h2>{readiness ? "Safety Score: 100%" : "Finish your safety setup"}</h2><p>{readiness ? "Your profile and connected safety hardware are ready." : "Add your details and link a device to complete setup."}</p></div>
      <i><ShieldCheck size={24} /></i>
    </section>
  </div>;
}
