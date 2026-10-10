"use client";

import Link from "next/link";
import {
  ChevronRight,
  MapPin,
  Navigation,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  X,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";
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

type NearbyResponderItem = { id: string; name: string; role: string; organisation: string; distanceKm: number };
type NearbyData = { count: number | null; scope: "linked" | "partners" | null; radiusKm: number; responders: NearbyResponderItem[] };
type ActiveSos = { id: string; type: "sos" | "medical"; status: string; acknowledged: number; enRoute: number; onScene: number };
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
  const [nearby, setNearby] = useState<NearbyData | null>(null);
  const [nearbyError, setNearbyError] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeSos, setActiveSos] = useState<ActiveSos | null>(null);
  const { allowed, reason: eligibility } = useLocationEligibility();

  useEffect(() => {
    let cancelled = false;
    const load = (coords?: { lat: number; lng: number }) => {
      const query = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : "";
      void fetch(`/api/account/nearby-responders${query}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("unavailable")))
        .then((data) => { if (!cancelled) { setNearby(data); setNearbyError(false); } })
        .catch(() => { if (!cancelled) setNearbyError(true); });
    };
    const refresh = () => {
      if (eligibility === "loading") return;
      // Nearby responders need the Live Location Sharing setting as well as the browser permission.
      if (!allowed || !navigator.geolocation) { setLocationDenied(true); return load(); }
      navigator.geolocation.getCurrentPosition(
        (position) => { setLocationDenied(false); load({ lat: position.coords.latitude, lng: position.coords.longitude }); },
        () => { setLocationDenied(true); load(); },
        { timeout: 8_000, maximumAge: 30_000 },
      );
    };
    const refreshSos = () => {
      void fetch("/api/account/sos/active", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { if (!cancelled && data) setActiveSos(data.alert ?? null); })
        .catch(() => undefined);
    };
    refresh();
    refreshSos();
    const timer = window.setInterval(refresh, 30_000);
    const sosTimer = window.setInterval(refreshSos, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); window.clearInterval(sosTimer); };
  }, [allowed, eligibility]);

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

    {activeSos && <button type="button" className="kiki-overview-cta" style={{ background: "#d9264e", width: "100%", marginBottom: 14, height: "auto", padding: "14px 18px", flexDirection: "column", alignItems: "flex-start", gap: 2 }} onClick={() => window.dispatchEvent(new CustomEvent("kiki:open-sos-response", { detail: { id: activeSos.id, type: activeSos.type } }))}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Siren size={20} aria-hidden="true" />Active {activeSos.type === "medical" ? "medical alert" : "SOS"} · tap to view live response</span>
      <small style={{ opacity: .9, fontWeight: 600 }}>{activeSos.onScene ? "Responder has arrived" : activeSos.enRoute ? `${activeSos.enRoute} responder${activeSos.enRoute === 1 ? "" : "s"} en route` : activeSos.acknowledged ? `${activeSos.acknowledged} responder${activeSos.acknowledged === 1 ? "" : "s"} acknowledged · not yet en route` : "Alert sent · waiting for a responder"}</small>
    </button>}

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
        <button type="button" className="kiki-overview-status-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
          <span className="kiki-overview-tile-icon"><ShieldCheck size={22} /></span>
          <span className="kiki-overview-status-copy"><strong>Responders</strong><span>{nearby?.count == null ? (nearbyError ? "Nearby responders unavailable" : locationDenied ? "Enable location to see responders" : "Checking nearby responders…") : `${nearby.count} ${nearby.count === 1 ? "responder" : "responders"} nearby`}</span></span>
          <span className={`kiki-overview-state${nearby?.count ? " is-on" : ""}`}><i />{nearbyError ? "Unavailable" : nearby?.count == null ? "Unknown" : nearby.count ? "Available" : "None nearby"}</span>
          <ChevronRight className="kiki-overview-chevron" size={17} />
        </button>

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
    {sheetOpen && <div role="dialog" aria-modal="true" aria-label="Nearby responders" onClick={() => setSheetOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1500, background: "rgba(29,3,31,.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ background: "#fff", width: "min(100%,520px)", maxHeight: "80vh", overflowY: "auto", borderRadius: "24px 24px 0 0", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>Responders nearby</h2>
          <button type="button" className="btn" aria-label="Close" onClick={() => setSheetOpen(false)}><X size={16} /></button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {nearby?.scope === "linked" ? "From your linked organisation" : "From official partner organisations"} · available and on duty within {nearby?.radiusKm ?? 10} km
        </p>
        {nearbyError ? <p>Nearby responders could not be loaded. Try again shortly.</p>
          : locationDenied && nearby?.count == null ? <p>Location is off or blocked. Allow location access in your browser to see responders near you.</p>
          : !nearby ? <p>Loading…</p>
          : nearby.count === 0 ? <p>No available responders within {nearby.radiusKm} km right now.{nearby.scope === "partners" ? " Only official partner organisations are searched because you aren’t linked to an organisation." : ""}</p>
          : <ul style={{ display: "grid", gap: 10 }}>{nearby.responders.map((item) => <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #f1edf5", paddingBottom: 8 }}>
            <span><b>{item.name}</b><br /><small className="muted">{item.role} · {item.organisation}</small></span>
            <span style={{ textAlign: "right", fontSize: 12 }}><b>{item.distanceKm} km</b><br /><small style={{ color: "#258257" }}>Available</small></span>
          </li>)}</ul>}
      </div>
    </div>}

    <section className="kiki-overview-section kiki-overview-recent" aria-labelledby="recent-trips-title">
      <div className="kiki-overview-section-head"><h2 id="recent-trips-title">Recent trips</h2><Link href="/account/trips">See all</Link></div>
      <div className="kiki-overview-group">
        {trips && trips.recent.length > 0
          ? trips.recent.slice(0, 3).map((trip) => <Link className="kiki-overview-trip-row" href={`/account/trips?destination=${encodeURIComponent(trip.id)}`} key={trip.id}>
            <span className="kiki-overview-route" aria-hidden="true"><i /><u /><i /></span>
            <span className="kiki-overview-trip-copy">
              <strong>{trip.destination_label}</strong>
            </span>
            <time dateTime={trip.ended_at ?? trip.created_at}>{formatTripDate(trip.ended_at ?? trip.created_at)}</time>
          </Link>)
          : <div className="kiki-overview-empty">{tripError ? "Recent trips are unavailable right now." : trips ? "Your completed trips will appear here." : "Loading recent trips…"}</div>}
      </div>
    </section>
  </div>;
}
