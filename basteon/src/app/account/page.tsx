"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ChevronRight,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  X,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";
import { getCurrentLocation } from "@/lib/platform/location";
import { createClient } from "@/lib/supabase/client";
import { AccountListCard, AccountListRow, AccountSectionLabel, AccountStatusPill } from "@/components/account/AccountList";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayerOptions";
import { MapBottomSheet, MapScreen } from "@/components/account/MapScreen";

const KikiSafetyMap = dynamic(() => import("@/components/KikiSafetyMap"), { ssr: false, loading: () => <div className="kiki-safety-map-loading" role="status">Loading map…</div> });

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
  fullName: string | null;
};

type NearbyResponderItem = { id: string; name: string; role: string; organisation: string; distanceKm: number };
type NearbyData = { count: number | null; availableCount: number; scope: "linked" | "partners" | null; radiusKm: number; responders: NearbyResponderItem[] };
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
  const [mapPoint, setMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [sheetLevel, setSheetLevel] = useState<0 | 1 | 2>(0);
  const [mapLayerIndex, setMapLayerIndex] = useState(0);
  const [mapRecenter, setMapRecenter] = useState(0);
  const { allowed, reason: eligibility } = useLocationEligibility();
  const refreshNearbyRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    void fetch("/api/account/profile/avatar")
      .then((response) => response.ok ? response.json() as Promise<{ url?: string | null }> : null)
      .then((avatar) => { if (active) setProfileImageUrl(avatar?.url ?? null); })
      .catch(() => { if (active) setProfileImageUrl(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestSequence = 0;
    const load = (sequence: number, coords?: { lat: number; lng: number }) => {
      const query = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : "";
      void fetch(`/api/account/nearby-responders${query}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("unavailable")))
        .then((data) => {
          if (!cancelled && sequence === requestSequence) {
            setNearby(data);
            setNearbyError(false);
          }
        })
        .catch(() => { if (!cancelled && sequence === requestSequence) setNearbyError(true); });
    };
    const refresh = () => {
      if (eligibility === "loading") return;
      const sequence = ++requestSequence;
      // Nearby responders need the Live Location Sharing setting as well as the browser permission.
      if (!allowed) { setLocationDenied(true); return load(sequence); }
      void getCurrentLocation({ timeout: 8_000, maximumAge: 30_000 }).then(
        (position) => {
          if (cancelled || sequence !== requestSequence) return;
          setMapPoint({ lat: position.lat, lng: position.lng });
          setLocationDenied(false);
          load(sequence, { lat: position.lat, lng: position.lng });
        },
      ).catch(() => {
          if (cancelled || sequence !== requestSequence) return;
          setLocationDenied(true);
          load(sequence);
        });
    };
    refreshNearbyRef.current = refresh;
    const presenceClient = createClient();
    const presenceChannel = presenceClient.channel("account-nearby-responder-presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "responder_presence" }, () => refresh())
      .subscribe();
    const refreshSos = () => {
      void fetch("/api/account/sos/active", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { if (!cancelled && data) setActiveSos(data.alert ?? null); })
        .catch(() => undefined);
    };
    refresh();
    refreshSos();
    const timer = window.setInterval(refresh, 15_000);
    const sosTimer = window.setInterval(refreshSos, 5_000);
    const refreshOnFocus = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      cancelled = true;
      refreshNearbyRef.current = () => {};
      window.clearInterval(timer);
      window.clearInterval(sosTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      void presenceClient.removeChannel(presenceChannel);
    };
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
        fullName: profile?.full_name ?? null,
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
  const hasSafetySetup = deviceCount > 0 && responderCount > 0;
  const responderStatusCopy = !nearby
    ? "Checking responders…"
    : nearby.count == null
      ? `${nearby.availableCount} on duty · enable location to check nearby responders`
      : `${nearby.count} available within ${nearby.radiusKm} km`;
  const responderStatusLabel = !nearby
    ? "Checking"
    : nearby.count == null
      ? nearby.availableCount ? "On duty" : "None on duty"
      : nearby.count ? "Nearby" : "None nearby";
  const currentMapLayer = MAP_BASE_LAYERS[mapLayerIndex]?.name as MapBaseLayerName | undefined;

  return <><MapScreen
    screenId="account-home"
    className="kiki-map-home"
    map={<KikiSafetyMap center={mapPoint} zoom={14} layer={currentMapLayer} recenter={mapRecenter} profileImageUrl={profileImageUrl} profileLabel={readiness?.fullName ?? "Kiki"} />}
    controls={<div className="kiki-map-actions" aria-label="Map shortcuts" data-map-ui="hide">
      <Link href="/account/buddies/safe-places?tab=spots" aria-label="Safe spots" title="Safe spots"><MapPin size={20} /></Link>
      <Link href="/account/buddies/safe-places?tab=alerts" aria-label="Community reports" title="Community reports"><AlertTriangle size={20} /></Link>
    </div>}
    onRecenter={() => { if (mapPoint) setMapRecenter((value) => value + 1); else refreshNearbyRef.current(); }}
    selectedLayer={currentMapLayer}
    onLayerChange={(layer) => setMapLayerIndex(MAP_BASE_LAYERS.findIndex((item) => item.name === layer))}
    bottomSheet={<MapBottomSheet level={sheetLevel} onLevelChange={setSheetLevel} label="Your safety map details">
      <div className="kiki-map-sheet-peek">
        <span className="kiki-map-avatar" aria-hidden="true">{readiness?.fullName?.trim().charAt(0).toUpperCase() || "K"}</span>
        <span className="kiki-map-peek-copy">
          <strong>{readiness?.fullName || "Your Kiki account"}</strong>
          <small>{activeTrip ? `Trip active · ${activeTrip.destination_label}` : hasSafetySetup ? "Your safety setup is ready" : "Complete your safety setup"}</small>
        </span>
        {activeTrip && <AccountStatusPill tone="positive">On trip</AccountStatusPill>}
      </div>
      <div className="kiki-map-sheet-details">
        {activeSos && <button type="button" className="kiki-overview-alert" onClick={() => window.dispatchEvent(new CustomEvent("kiki:open-sos-response", { detail: { id: activeSos.id, type: activeSos.type } }))}>
          <span className="kiki-overview-alert-icon"><Siren size={20} aria-hidden="true" /></span>
          <span className="kiki-overview-alert-copy"><strong>Active {activeSos.type === "medical" ? "medical alert" : "SOS"}</strong><span>{activeSos.onScene ? "A responder has arrived" : activeSos.enRoute ? `${activeSos.enRoute} responder${activeSos.enRoute === 1 ? "" : "s"} en route` : activeSos.acknowledged ? `${activeSos.acknowledged} acknowledged` : "Waiting for a responder"}</span></span>
          <ChevronRight size={18} />
        </button>}
        {activeTrip && <Link className="kiki-overview-cta" href="/account/trips"><Navigation size={18} />Open active trip</Link>}
        <section className="kiki-overview-section" aria-labelledby="safety-circle-title">
          <AccountSectionLabel>Safety circle</AccountSectionLabel>
          <AccountListCard className="kiki-overview-group" aria-label="Safety circle">
        <AccountListRow
          href="/account/devices"
          icon={<Radio size={20} />}
          title="Kiki hardware"
          subtitle={`${deviceCount} ${deviceCount === 1 ? "device" : "devices"} linked`}
          trailing={<><AccountStatusPill tone={readinessError ? "warning" : connectedDeviceCount ? "positive" : "neutral"}>{readinessError ? "Unavailable" : connectedDeviceCount ? "Connected" : deviceCount ? "Offline" : "Not linked"}</AccountStatusPill><ChevronRight className="kiki-overview-chevron" size={17} /></>}
        />
        <AccountListRow
          onClick={() => { setSheetOpen(true); refreshNearbyRef.current(); }}
          icon={<ShieldCheck size={20} />}
          title="Responders"
          subtitle={nearbyError ? "Availability unavailable" : responderStatusCopy}
          trailing={<><AccountStatusPill tone={nearbyError ? "warning" : nearby?.count ? "positive" : nearby?.count === 0 ? "neutral" : "warning"}>{nearbyError ? "Unavailable" : responderStatusLabel}</AccountStatusPill><ChevronRight className="kiki-overview-chevron" size={17} /></>}
        />
        <AccountListRow
          href="/account/buddies"
          icon={<UsersRound size={20} />}
          title="Buddy watch"
          subtitle={buddy?.active ? buddy.visible ? "Visible to nearby Buddies" : "Trip active but hidden" : "No trip active"}
          trailing={<><AccountStatusPill tone={buddyError ? "warning" : buddy?.active && buddy.visible ? "positive" : "neutral"}>{buddyError ? "Unavailable" : buddy?.active ? buddy.visible ? "Sharing" : "Hidden" : "Off"}</AccountStatusPill><ChevronRight className="kiki-overview-chevron" size={17} /></>}
        />
        <AccountListRow
          href="/account/trips"
          icon={<Route size={20} />}
          title="Route Watch"
          subtitle={activeTrip ? `Monitoring trip to ${activeTrip.destination_label}` : "No active trip"}
          trailing={<><AccountStatusPill tone={tripError ? "warning" : activeTrip ? "positive" : "neutral"}>{tripError ? "Unavailable" : activeTrip ? "Active" : "Off"}</AccountStatusPill><ChevronRight className="kiki-overview-chevron" size={17} /></>}
        />
          </AccountListCard>
        </section>
        <section className="kiki-overview-section kiki-overview-recent" aria-labelledby="recent-trips-title">
          <div className="kiki-overview-section-head"><AccountSectionLabel>Recent trips</AccountSectionLabel><Link href="/account/trips">See all</Link></div>
          <AccountListCard className="kiki-overview-group" aria-label="Recent trips">
            {trips && trips.recent.length > 0
              ? trips.recent.slice(0, 3).map((trip) => <Link className="kiki-overview-trip-row" href={`/account/trips?destination=${encodeURIComponent(trip.id)}`} key={trip.id}>
                <span className="kiki-overview-route" aria-hidden="true"><i /><u /><i /></span>
                <span className="kiki-overview-trip-copy"><strong>{trip.destination_label}</strong></span>
                <time dateTime={trip.ended_at ?? trip.created_at}>{formatTripDate(trip.ended_at ?? trip.created_at)}</time>
              </Link>)
              : <div className="kiki-overview-empty">{tripError ? "Recent trips are unavailable." : trips ? "No completed trips yet." : "Loading recent trips…"}</div>}
          </AccountListCard>
        </section>
      </div>
    </MapBottomSheet>}
    hiddenActions={<button type="button" className="map-screen-sos" onClick={() => window.dispatchEvent(new Event("kiki:open-sos"))}><Siren size={19} />SOS</button>}
  />
    {sheetOpen && <div className="kiki-overview-responders-scrim" role="dialog" aria-modal="true" aria-label="Nearby responders" onClick={() => setSheetOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="kiki-overview-responders-sheet" onClick={(event) => event.stopPropagation()} style={{ width: "min(100%,520px)", maxHeight: "80vh", overflowY: "auto", borderRadius: "24px 24px 0 0", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>Responders nearby</h2>
          <button type="button" className="btn" aria-label="Close" onClick={() => setSheetOpen(false)}><X size={16} /></button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          {nearby?.scope === "linked" ? "From your linked organisation" : "From official partner organisations"} · {nearby?.availableCount ?? 0} currently on duty
        </p>
        {nearbyError ? <p>Nearby responders could not be loaded. Try again shortly.</p>
          : !nearby ? <p>Loading…</p>
          : nearby.count == null ? <p>{nearby.availableCount ? `${nearby.availableCount} responder${nearby.availableCount === 1 ? " is" : "s are"} available with your organisation. Allow location access to see which responders are nearby.` : "No responders are currently marked available with your organisation."}</p>
          : nearby.count === 0 ? <p>{nearby.availableCount ? `${nearby.availableCount} responder${nearby.availableCount === 1 ? " is" : "s are"} on duty, but none shared a recent location within ${nearby.radiusKm} km.` : `No responders are currently available within ${nearby.radiusKm} km.`}{nearby.scope === "partners" ? " Only official partner organisations are searched because you aren’t linked to an organisation." : ""}</p>
          : <ul style={{ display: "grid", gap: 10 }}>{nearby.responders.map((item) => <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #f1edf5", paddingBottom: 8 }}>
            <span><b>{item.name}</b><br /><small className="muted">{item.role} · {item.organisation}</small></span>
            <span style={{ textAlign: "right", fontSize: 12 }}><b>{item.distanceKm} km</b><br /><small style={{ color: "#258257" }}>Available</small></span>
          </li>)}</ul>}
      </div>
    </div>}
  </>;
}
