"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  Radio,
  Route,
  ShieldCheck,
  Siren,
  X,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";
import { getCurrentLocation } from "@/lib/platform/location";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";
import { CommunityAlertsPanel } from "@/components/CommunityAlertsPanel";
import { AccountStatusPill } from "@/components/account/AccountList";
import { MAP_BASE_LAYERS, type MapBaseLayerName } from "@/lib/mapLayerOptions";
import { MapBottomSheet, MapScreen } from "@/components/account/MapScreen";
import { categoryLabel, directionsUrl, type CommunityAlert, type PublicSpot } from "@/lib/buddies/meeting/client";
import type { SafetyMapPoint } from "@/components/KikiSafetyMap";

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
  homeAddress: string | null;
};

type NearbyResponderItem = { id: string; name: string; role: string; organisation: string; distanceKm: number };
type NearbyData = { count: number | null; availableCount: number; scope: "linked" | "partners" | null; radiusKm: number; responders: NearbyResponderItem[] };
type ActiveSos = { id: string; type: "sos" | "medical"; status: string; acknowledged: number; enRoute: number; onScene: number };
const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export default function AccountPage() {
  const [exploreSegment, setExploreSegment] = useState<"pulse" | "havens" | "walks">("pulse");
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
  const [communityReports, setCommunityReports] = useState<CommunityAlert[]>([]);
  const [safeHavens, setSafeHavens] = useState<PublicSpot[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityMessage, setCommunityMessage] = useState("");
  const { allowed, reason: eligibility } = useLocationEligibility();
  const refreshNearbyRef = useRef<() => void>(() => {});
  const mapPoints = useMemo<SafetyMapPoint[]>(() => [
    ...communityReports.map((report) => ({
      id: report.id,
      lat: report.lat,
      lng: report.lng,
      kind: "report" as const,
      category: report.kind,
      createdAt: report.created_at,
      upvotes: report.upvotes,
    })),
    ...safeHavens.map((place) => ({ id: place.id, lat: place.lat, lng: place.lng, kind: "spot" as const, category: place.category })),
  ], [communityReports, safeHavens]);

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
    if (!mapPoint) return;
    let active = true;
    const query = new URLSearchParams({ lat: String(mapPoint.lat), lng: String(mapPoint.lng) });
    const loadNearby = async () => {
      try {
        const [reportsResponse, havensResponse] = await Promise.all([
          fetch(`/api/buddies/community-alerts?${query}`, { cache: "no-store" }),
          fetch(`/api/buddies/safe-places?${query}`, { cache: "no-store" }),
        ]);
        if (!reportsResponse.ok || !havensResponse.ok) throw new Error("Nearby community data is temporarily unavailable.");
        const [reportsData, havensData] = await Promise.all([
          reportsResponse.json() as Promise<{ alerts?: CommunityAlert[] }>,
          havensResponse.json() as Promise<{ places?: PublicSpot[] }>,
        ]);
        if (!active) return;
        setCommunityReports(reportsData.alerts ?? []);
        setSafeHavens(havensData.places ?? []);
        setCommunityError("");
      } catch (error) {
        if (active) setCommunityError(error instanceof Error ? error.message : "Nearby community data is temporarily unavailable.");
      } finally {
        if (active) setCommunityLoading(false);
      }
    };
    setCommunityLoading(true);
    void loadNearby();
    const supabase = createClient();
    const channel = supabase.channel("explore-community-data")
      .on("broadcast", { event: "changed" }, () => { void loadNearby(); })
      .subscribe();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadNearby();
    };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      void supabase.removeChannel(channel);
    };
  }, [mapPoint]);

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
        supabase.from("profiles").select("full_name,home_address,phone,emergency_contact_name,emergency_contact_phone").eq("id", user.id).single(),
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
        homeAddress: profile?.home_address?.trim() || null,
      });
    })().catch(() => {
      if (!cancelled) setReadinessError(true);
    });
    return () => { cancelled = true; };
  }, []);

  const activeTrip = trips?.trip ?? null;
  const mapPeekSubtitle = activeTrip
    ? `Trip active · ${activeTrip.destination_label}`
    : activeSos
      ? `Active ${activeSos.type === "medical" ? "medical alert" : "SOS"}`
      : buddy?.active
        ? buddy.visible ? "Buddy walk active" : "Buddy walk active · hidden"
        : readinessError
          ? "Location address unavailable"
          : readiness?.homeAddress || "Add your home address in Profile";
  const currentMapLayer = MAP_BASE_LAYERS[mapLayerIndex]?.name as MapBaseLayerName | undefined;

  const reportCountLabel = `${communityReports.length} ${communityReports.length === 1 ? "report" : "reports"} nearby`;

  return <><MapScreen
    screenId="account-home"
    className="kiki-map-home"
    map={<KikiSafetyMap center={mapPoint} points={mapPoints} zoom={14} layer={currentMapLayer} recenter={mapRecenter} profileImageUrl={profileImageUrl} profileLabel={readiness?.fullName ?? "Kiki"} userLocationStyle="dot" />}
    topBar={<div className="kiki-explore-hud">
      <Link href="/account/guardians" className="kiki-explore-circle-link">
        <span className="kiki-explore-circle-icon"><UsersRound size={19} aria-hidden="true" /></span>
        <span><strong>Guardian Circle</strong><small>{activeTrip ? "Your walk is active" : buddy?.active ? "Buddy walk active" : "Your trusted people"}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </Link>
      <span className={`kiki-explore-status${communityReports.length ? " has-reports" : ""}`}>
        {communityLoading ? "Updating nearby" : communityError ? "Community unavailable" : communityReports.length ? reportCountLabel : "No reports nearby"}
      </span>
      <NotificationBell />
    </div>}
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
          <small>{mapPeekSubtitle}</small>
        </span>
        {activeTrip && <AccountStatusPill tone="positive">On trip</AccountStatusPill>}
      </div>
      <div className="kiki-explore-segmented" role="group" aria-label="Explore map views">
        <button type="button" aria-pressed={exploreSegment === "pulse"} onClick={() => setExploreSegment("pulse")}>Pulse{communityReports.length > 0 && <span>{communityReports.length}</span>}</button>
        <button type="button" aria-pressed={exploreSegment === "havens"} onClick={() => setExploreSegment("havens")}>Havens{safeHavens.length > 0 && <span>{safeHavens.length}</span>}</button>
        <button type="button" aria-pressed={exploreSegment === "walks"} onClick={() => setExploreSegment("walks")}>Walks</button>
      </div>
      {communityMessage && <p className="kiki-explore-message" role="status">{communityMessage}</p>}
      {exploreSegment === "pulse" && <section className="kiki-explore-panel" aria-label="Pulse">
        {communityError && <div className="kiki-explore-error" role="alert"><span>{communityError}</span><button type="button" onClick={() => { if (mapPoint) setMapPoint({ ...mapPoint }); }}>Retry</button></div>}
        {!mapPoint && <div className="kiki-explore-empty"><MapPin size={20} /><strong>Location is needed for nearby reports</strong><span>Enable location sharing to see community updates around you.</span></div>}
        {mapPoint && <CommunityAlertsPanel
          alerts={communityReports}
          busy={communityBusy}
          initialPoint={mapPoint}
          onBusyChange={setCommunityBusy}
          onAlertsChange={setCommunityReports}
          onLocationChange={setMapPoint}
          onMessage={setCommunityMessage}
        />}
      </section>}
      {exploreSegment === "havens" && <section className="kiki-explore-panel" aria-label="Safe havens">
        <div className="kiki-explore-section-heading"><div><strong>Nearby havens</strong><small>Reviewed public places in your area</small></div><Link href="/account/buddies/safe-places?tab=spots" aria-label="See all havens"><ArrowRight size={18} /></Link></div>
        {communityError && <div className="kiki-explore-error" role="alert"><span>{communityError}</span><button type="button" onClick={() => { if (mapPoint) setMapPoint({ ...mapPoint }); }}>Retry</button></div>}
        {communityLoading && <p className="kiki-explore-status-copy">Loading nearby places…</p>}
        {!communityLoading && !communityError && safeHavens.length === 0 && <div className="kiki-explore-empty"><MapPinned size={20} /><strong>No havens listed nearby yet</strong><span>Check again later or suggest a public place.</span><Link href="/account/buddies/safe-places?tab=spots">Explore safe places</Link></div>}
        {safeHavens.slice(0, 8).map((place) => <article className="kiki-haven-row" key={place.id}>
          <span className="kiki-haven-icon"><MapPin size={18} aria-hidden="true" /></span>
          <span className="kiki-haven-copy"><strong>{place.name}</strong><small>{categoryLabel(place.category)}{place.open_24h ? " · Open 24 hours" : ""}</small></span>
          {!place.is_demo && <CheckCircle2 className="kiki-haven-reviewed" size={16} aria-label="Reviewed" />}
          {!place.is_demo && <a className="kiki-haven-directions" href={directionsUrl(place.lat, place.lng)} target="_blank" rel="noreferrer" aria-label={`Directions to ${place.name}`}><Navigation size={17} /></a>}
        </article>)}
      </section>}
      {exploreSegment === "walks" && <section className="kiki-explore-panel" aria-label="Walks">
        {(tripError || buddyError) && <p className="kiki-explore-error" role="alert">Some walk status could not be loaded. Open Trips to check your active walks.</p>}
        {activeTrip && <article className="kiki-walk-live-card">
          <span className="kiki-walk-live-indicator" />
          <div><small>Route Watch</small><strong>{activeTrip.destination_label}</strong><span>{activeTrip.mode} · {activeTrip.status}</span></div>
          <Link href="/account/trips" aria-label="Open active walk"><ChevronRight size={19} /></Link>
        </article>}
        {buddy?.active && <article className="kiki-walk-live-card">
          <span className="kiki-walk-live-indicator" />
          <div><small>Travel Together</small><strong>{buddy.alias ?? "Buddy walk"}</strong><span>{buddy.visible ? "Visible to nearby Buddies" : "Location sharing is hidden"}</span></div>
          <Link href="/account/trips?mode=travel-together" aria-label="Open Buddy walk"><ChevronRight size={19} /></Link>
        </article>}
        {!activeTrip && !buddy?.active && !tripError && !buddyError && <div className="kiki-explore-empty"><Route size={20} /><strong>No active walks</strong><span>Start Route Watch or plan a walk with your Buddies.</span></div>}
        <Link className="kiki-walk-entry-row" href="/account/trips"><Route size={19} /><span><strong>Route Watch</strong><small>Plan a route and check in along the way</small></span><ChevronRight size={18} /></Link>
        <Link className="kiki-walk-entry-row" href="/account/trips?mode=travel-together"><UsersRound size={19} /><span><strong>Travel Together</strong><small>Create or join a Bubble</small></span><ChevronRight size={18} /></Link>
      </section>}
      {activeSos && <button type="button" className="kiki-overview-alert" onClick={() => window.dispatchEvent(new CustomEvent("kiki:open-sos-response", { detail: { id: activeSos.id, type: activeSos.type } }))}>
        <span className="kiki-overview-alert-icon"><Siren size={20} aria-hidden="true" /></span>
        <span className="kiki-overview-alert-copy"><strong>Active {activeSos.type === "medical" ? "medical alert" : "SOS"}</strong><span>{activeSos.onScene ? "A responder has arrived" : activeSos.enRoute ? `${activeSos.enRoute} responder${activeSos.enRoute === 1 ? "" : "s"} en route` : activeSos.acknowledged ? `${activeSos.acknowledged} acknowledged` : "Waiting for a responder"}</span></span>
        <ChevronRight size={18} />
      </button>}
      {/* Safety status stays available as a quick destination beneath the map segments. */}
      <div className="kiki-explore-quick-links">
        <Link href="/account/devices"><Radio size={17} />Kiki devices<ChevronRight size={16} /></Link>
        <Link href="/account/profile"><ShieldCheck size={17} />Safety tools<ChevronRight size={16} /></Link>
        <button type="button" onClick={() => { setSheetOpen(true); refreshNearbyRef.current(); }}><UsersRound size={17} />Responders nearby<ChevronRight size={16} /></button>
      </div>
    </MapBottomSheet>}
    hiddenActions={<button type="button" className="map-screen-sos" onClick={() => window.dispatchEvent(new Event("kiki:open-sos"))}><Siren size={30} strokeWidth={2.5} />SOS</button>}
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
