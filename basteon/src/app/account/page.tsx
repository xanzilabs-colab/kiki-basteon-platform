"use client";

import Link from "next/link";
import {
  Check,
  ChevronRight,
  MapPin,
  Navigation,
  Radio,
  Route,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type TripActivity = {
  id: string;
  destination_label: string;
  mode: string;
  status: string;
  created_at: string;
  ended_at: string | null;
};
type BuddyActivity = { active: boolean; visible?: boolean; alias?: string; expiresAt?: string };
type DeviceStatus = { active: boolean; last_seen_at: string | null };
type ReadinessData = {
  profileComplete: boolean;
  deviceCount: number;
  connectedDeviceCount: number;
  responderCount: number;
};

const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

function formatTripDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AccountPage() {
  const [trips, setTrips] = useState<{ trip: TripActivity | null; recent: TripActivity[] } | null>(null);
  const [tripError, setTripError] = useState(false);
  const [buddy, setBuddy] = useState<BuddyActivity | null>(null);
  const [buddyError, setBuddyError] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [readinessError, setReadinessError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/trips")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Trip data unavailable")))
      .then((data) => {
        if (!cancelled) setTrips({ trip: data.trip ?? null, recent: data.recent ?? [] });
      })
      .catch(() => {
        if (!cancelled) setTripError(true);
      });
    void fetch("/api/buddies/trips")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Buddy data unavailable")))
      .then((data) => {
        if (!cancelled) setBuddy(data);
      })
      .catch(() => {
        if (!cancelled) setBuddyError(true);
      });
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Could not load account readiness.");
      const [{ data: profile, error: profileError }, { data: devices, error: deviceError }, { count: guardianCount, error: guardianError }] = await Promise.all([
        supabase.from("profiles").select("full_name,phone,emergency_contact_name,emergency_contact_phone").eq("id", user.id).single(),
        supabase.from("devices").select("active,last_seen_at"),
        supabase.from("guardians").select("id", { count: "exact", head: true }),
      ]);
      if (profileError || deviceError || guardianError) throw new Error("Could not load account readiness.");
      const deviceRows = (devices ?? []) as DeviceStatus[];
      const now = Date.now();
      const connectedDeviceCount = deviceRows.filter((device) =>
        device.active && device.last_seen_at && now - new Date(device.last_seen_at).getTime() <= DEVICE_ONLINE_WINDOW_MS,
      ).length;
      if (!cancelled) setReadiness({
        profileComplete: Boolean(profile?.full_name?.trim() && profile.phone?.trim()),
        deviceCount: deviceRows.length,
        connectedDeviceCount,
        responderCount: (guardianCount ?? 0) + Number(Boolean(profile?.emergency_contact_name?.trim() && profile.emergency_contact_phone?.trim())),
      });
    })().catch(() => {
      if (!cancelled) setReadinessError(true);
    });
    return () => { cancelled = true; };
  }, []);

  const activeTrip = trips?.trip ?? null;
  const deviceCount = readiness?.deviceCount ?? 0;
  const connectedDeviceCount = readiness?.connectedDeviceCount ?? 0;
  const responderCount = readiness?.responderCount ?? 0;
  const progress = readiness
    ? Math.round(([deviceCount > 0, responderCount > 0, Boolean(activeTrip)].filter(Boolean).length / 3) * 100)
    : 0;
  const ringOffset = 289 - (289 * progress) / 100;
  const hasSafetySetup = deviceCount > 0 && responderCount > 0;

  return <div className="kiki-overview">
    <h1 className="kiki-overview-title">You’re protected.</h1>

    <section className="kiki-overview-hero" aria-label="Safety readiness">
      <div className="kiki-overview-hero-row">
        <div className="kiki-overview-ring" role="img" aria-label={`${progress}% ready`}>
          <svg viewBox="0 0 104 104" aria-hidden="true">
            <circle className="ring-track" cx="52" cy="52" r="46" />
            <circle className="ring-progress" cx="52" cy="52" r="46" style={{ strokeDasharray: 289, strokeDashoffset: ringOffset }} />
          </svg>
          <strong>{readinessError ? "—" : progress}<small>{readinessError ? "" : "%"}</small></strong>
        </div>
        <div className="kiki-overview-hero-copy">
          <h2>{activeTrip ? "Trip protection active" : hasSafetySetup ? "System ready" : "Setup in progress"}</h2>
          <p>
            {readinessError
              ? "Safety readiness is temporarily unavailable. You can still plan a safe trip."
              : activeTrip
                ? "Route Watch is monitoring your active trip. Check in whenever you need."
                : hasSafetySetup
                  ? "Your device and emergency contacts are ready. Start a trip to activate Route Watch."
                  : "Add a Kiki device and emergency contact to strengthen your safety setup."}
          </p>
        </div>
      </div>
      <Link className="kiki-overview-cta" href="/account/trips">
        <Navigation size={21} aria-hidden="true" />
        {activeTrip ? "Open active trip" : "Plan a safe trip"}
      </Link>
    </section>

    <section className="kiki-overview-section" aria-labelledby="safety-circle-title">
      <div className="kiki-overview-section-head"><h2 id="safety-circle-title">Your safety circle</h2></div>
      <div className="kiki-overview-group">
        <Link className="kiki-overview-status-row" href="/account/devices">
          <span className="kiki-overview-tile-icon"><Radio size={22} /></span>
          <span className="kiki-overview-status-copy"><strong>Kiki hardware</strong><span>{deviceCount} {deviceCount === 1 ? "device" : "devices"} linked</span></span>
          <span className={`kiki-overview-state${connectedDeviceCount ? " is-on" : ""}`}><i />{readinessError ? "Unavailable" : connectedDeviceCount ? "Connected" : deviceCount ? "Offline" : "Not linked"}</span>
          <ChevronRight className="kiki-overview-chevron" size={17} />
        </Link>
        <Link className="kiki-overview-status-row" href="/account/guardians">
          <span className="kiki-overview-tile-icon"><ShieldCheck size={22} /></span>
          <span className="kiki-overview-status-copy"><strong>Responders</strong><span>{responderCount} {responderCount === 1 ? "contact" : "contacts"} active</span></span>
          <span className={`kiki-overview-state${responderCount ? " is-on" : ""}`}><i />{readinessError ? "Unavailable" : responderCount ? "Ready" : "Add contact"}</span>
          <ChevronRight className="kiki-overview-chevron" size={17} />
        </Link>
        <Link className="kiki-overview-status-row" href="/account/buddies">
          <span className="kiki-overview-tile-icon"><UsersRound size={22} /></span>
          <span className="kiki-overview-status-copy"><strong>Buddy watch</strong><span>{buddy?.active ? buddy.visible ? "Visible to nearby Buddies" : "Buddy trip active · hidden" : "No Buddy trip active"}</span></span>
          <span className={`kiki-overview-state${buddy?.active && buddy.visible ? " is-on" : ""}`}><i />{buddyError ? "Unavailable" : buddy?.active ? buddy.visible ? "Sharing" : "Hidden" : "Off"}</span>
          <ChevronRight className="kiki-overview-chevron" size={17} />
        </Link>
        <Link className="kiki-overview-status-row" href="/account/trips">
          <span className="kiki-overview-tile-icon"><Route size={22} /></span>
          <span className="kiki-overview-status-copy"><strong>Route Watch</strong><span>{activeTrip ? `Monitoring trip to ${activeTrip.destination_label}` : "No active trip"}</span></span>
          <span className={`kiki-overview-state${activeTrip ? " is-on" : ""}`}><i />{tripError ? "Unavailable" : activeTrip ? "Active" : "Off"}</span>
          <ChevronRight className="kiki-overview-chevron" size={17} />
        </Link>
      </div>
    </section>

    <section className="kiki-overview-section kiki-overview-recent" aria-labelledby="recent-trips-title">
      <div className="kiki-overview-section-head"><h2 id="recent-trips-title">Recent trips</h2><Link href="/account/trips/history">See all</Link></div>
      <div className="kiki-overview-group">
        {trips && trips.recent.length > 0
          ? trips.recent.slice(0, 3).map((trip) => <Link className="kiki-overview-trip-row" href="/account/trips/history" key={trip.id}>
            <span className="kiki-overview-route" aria-hidden="true"><i /><u /><i /></span>
            <span className="kiki-overview-trip-copy">
              <strong>{trip.destination_label}</strong>
              <span>{trip.mode === "walk" ? "Walk" : "Taxi"}</span>
              {trip.status === "arrived" && <span className="kiki-overview-arrived"><Check size={14} />Arrived safely</span>}
            </span>
            <time dateTime={trip.ended_at ?? trip.created_at}>{formatTripDate(trip.ended_at ?? trip.created_at)}</time>
          </Link>)
          : <div className="kiki-overview-empty">{tripError ? "Recent trips are unavailable right now." : trips ? "Your completed trips will appear here." : "Loading recent trips…"}</div>}
      </div>
    </section>
  </div>;
}
