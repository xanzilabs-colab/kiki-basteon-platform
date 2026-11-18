"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activeStatuses } from "@/lib/status";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { useAlertTrail } from "@/hooks/useAlertTrail";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useServerNow } from "@/hooks/useServerNow";
import { AlertList } from "@/components/AlertList";
import { AlertDetailPanel } from "@/components/AlertDetailPanel";
import { ResponderLocationPublisher } from "@/components/ResponderLocationPublisher";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { SoundToggle } from "@/components/SoundToggle";
import { Navbar } from "@/components/Navbar";
import { BasteonBrand } from "@/components/BasteonBrand";
import { NotificationBell } from "@/components/NotificationBell";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import { useResponderBrandingSeed } from "@/components/ResponderBrandingProvider";
import { useAppDialog } from "@/components/AppDialogProvider";
import type { Alert, ProfileContact } from "@/lib/types";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { createClient } from "@/lib/supabase/client";
import { fmtRelativeTime } from "@/lib/datetime";
import { isMovingAlert } from "@/lib/motion";
import { MAP_BASE_LAYERS } from "@/lib/mapLayers";
import { BASTEON_BRAND_PRIMARY, BRAND_HEX_PATTERN, brandCssProperties } from "@/lib/organisationBranding";
import { formatCurrentResponderStatus } from "@/lib/currentResponderStatus";
import { AlertTriangle, ArrowLeft, HeartHandshake, LayoutDashboard, LocateFixed, LockKeyhole, LogOut, Map as MapIcon, Mountain, Moon, Satellite, Settings } from "lucide-react";
import { alertDeviceLabel, alertOwnerName } from "@/lib/alertDisplay";
import { AlertTypeBadge } from "@/components/alerts/AlertTypeBadge";
import { toast } from "sonner";
import styles from "./ResponderDashboard.module.css";

const AlertMap = dynamic(() => import("@/components/AlertMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center">
      <span className="label">Initialising map…</span>
    </div>
  ),
});

const MAP_LAYER_ICONS = {
  Street: MapIcon,
  Satellite,
  Terrain: Mountain,
  Humanitarian: HeartHandshake,
  Dark: Moon,
};

type CachedResponderBranding = {
  id: string;
  name: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  branchName: string;
};

function readCachedResponderBranding(organisationId: string): CachedResponderBranding | null {
  if (!organisationId) return null;
  const key = `basteon-responder-branding:${organisationId}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedResponderBranding>;
    const valid = value.id === organisationId
      && typeof value.name === "string"
      && typeof value.displayName === "string"
      && (value.logoUrl === null || typeof value.logoUrl === "string")
      && (value.primaryColor === null || (typeof value.primaryColor === "string" && BRAND_HEX_PATTERN.test(value.primaryColor)))
      && (value.accentColor === null || (typeof value.accentColor === "string" && BRAND_HEX_PATTERN.test(value.accentColor)))
      && typeof value.branchName === "string";
    if (!valid) {
      console.warn("Ignoring invalid cached responder branding for organisation", organisationId);
      window.sessionStorage.removeItem(key);
      return null;
    }
    return value as CachedResponderBranding;
  } catch (error) {
    console.warn("Could not read cached responder branding.", error);
    return null;
  }
}

function cacheResponderBranding(value: CachedResponderBranding) {
  try {
    window.sessionStorage.setItem(`basteon-responder-branding:${value.id}`, JSON.stringify(value));
  } catch (error) {
    console.warn("Could not cache responder branding.", error);
  }
}

export default function ResponderPage() {
  const router = useRouter();
  const initialBranding = useResponderBrandingSeed();
  const [responderView, setResponderView] = useState<"alerts" | "overview" | "settings">("alerts");
  const [organisationId, setOrganisationId] = useState(initialBranding.id);
  const [organisationLoading, setOrganisationLoading] = useState(true);
  const [organisationLoadError, setOrganisationLoadError] = useState("");
  const [organisationLoadAttempt, setOrganisationLoadAttempt] = useState(0);
  const [organisationBlocked, setOrganisationBlocked] = useState(false);
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts();
  const serverNow = useServerNow();
  const { confirm } = useAppDialog();
  const { position, error, refreshing: refreshingLocation, refreshLocation } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCleared, setDetailCleared] = useState(false);
  const [mobileAlertPane, setMobileAlertPane] = useState<"queue" | "map" | "detail">("queue");
  const [mobileReturnPane, setMobileReturnPane] = useState<"queue" | "map">("queue");
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"active" | "all">("active");
  const [profile, setProfile] = useState<ProfileContact | null>(null);
  const [operatorName, setOperatorName] = useState(initialBranding.operatorName);
  const [organisationName, setOrganisationName] = useState(initialBranding.name);
  const [organisationDisplayName, setOrganisationDisplayName] = useState(initialBranding.displayName);
  const [organisationLogo, setOrganisationLogo] = useState<string | null>(initialBranding.logoUrl);
  const [logoLoadFailedUrl, setLogoLoadFailedUrl] = useState<string | null>(null);
  const [branchName, setBranchName] = useState(initialBranding.branchName);
  const [brandPrimaryColor, setBrandPrimaryColor] = useState(initialBranding.primaryColor);
  const [brandAccentColor, setBrandAccentColor] = useState(initialBranding.accentColor);
  const [canDispatch, setCanDispatch] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [movingOnly, setMovingOnly] = useState(false);
  const [mapBaseLayer, setMapBaseLayer] = useState<(typeof MAP_BASE_LAYERS)[number]["name"]>("Street");
  const [mapRecenterToken, setMapRecenterToken] = useState(0);
  const [selfAvailability, setSelfAvailability] = useState<string | null>(null);
  const [selfResponseStatus, setSelfResponseStatus] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState("");
  const [statusRefreshError, setStatusRefreshError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [supportContacts, setSupportContacts] = useState<Array<any>>([]);
  const emergencyTypes = useEmergencyTypes();

  useEffect(() => {
    setOrganisationId(initialBranding.id);
    setOrganisationName(initialBranding.name);
    setOrganisationDisplayName(initialBranding.displayName);
    setOrganisationLogo(initialBranding.logoUrl);
    setBranchName(initialBranding.branchName);
    setOperatorName(initialBranding.operatorName);
    setBrandPrimaryColor(initialBranding.primaryColor);
    setBrandAccentColor(initialBranding.accentColor);
    setLogoLoadFailedUrl(null);
  }, [initialBranding]);

  useEffect(() => {
    let active = true;
    void fetch("/api/alerts/dismiss", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Dismissed alerts could not be loaded.");
        return data.dismissedAlertIds;
      })
      .then((ids: unknown) => {
        if (active && Array.isArray(ids)) setDismissedAlertIds(new Set(ids.filter((id): id is string => typeof id === "string")));
      })
      .catch((failure) => {
        console.error("Responder alert dismissals could not be loaded", failure);
        if (active) toast.error("Alerts removed from your active queue could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setOrganisationLoading(true);
      setOrganisationLoadError("");
      try {
        const client = createClient();
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw new Error("Your session could not be verified.");
        if (active) setSelfUserId(user.id);
        const { data: profileRow } = await client.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
        if (active) setOperatorName(profileRow?.full_name ?? user.email ?? "Responder");
        const response = await fetch("/api/organisation/me", { cache: "no-store" });
        if (response.status === 403) {
          if (active) {
            setOrganisationId("");
            setOrganisationName("");
            setOrganisationDisplayName("");
            setOrganisationLogo(null);
            setLogoLoadFailedUrl(null);
            setBranchName("");
            setBrandPrimaryColor(null);
            setBrandAccentColor(null);
            setOrganisationBlocked(false);
            setSelfAvailability(null);
            setSelfResponseStatus(null);
          }
          return;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Organisation details could not be loaded.");
        if (!active) return;
        setStatusRefreshError("");
        setOrganisationBlocked(Boolean(body?.blocked?.isBlocked));
        const organisation = body?.organisation ?? {};
        const resolvedOrganisationId = typeof organisation.id === "string" ? organisation.id : "";
        const membership = (body?.memberships ?? []).find((item: any) => item.organisation_id === resolvedOrganisationId);
        const resolvedBranchName = (body?.branches ?? []).find((branch: any) => branch.id === membership?.branch_id)?.name ?? "";
        const resolvedName = organisation.display_name?.trim() || organisation.name || "";
        const legalName = organisation.name ?? "";
        const resolvedLogo = organisation.logo_url ?? null;
        const resolvedPrimary = organisation.brand_primary_color ?? null;
        const resolvedAccent = organisation.brand_accent_color ?? null;
        if (body?.blocked?.isBlocked) {
          setOrganisationName(resolvedName);
          setOrganisationDisplayName(resolvedName);
          setOrganisationLogo(resolvedLogo);
          setLogoLoadFailedUrl(null);
          setBranchName(resolvedBranchName);
          setBrandPrimaryColor(resolvedPrimary);
          setBrandAccentColor(resolvedAccent);
          setOrganisationId("");
          setSelfAvailability(null);
          setSelfResponseStatus(null);
          return;
        }
        setOrganisationName(legalName);
        setOrganisationDisplayName(resolvedName);
        setOrganisationLogo(resolvedLogo);
        setLogoLoadFailedUrl(null);
        setBranchName(resolvedBranchName);
        setBrandPrimaryColor(resolvedPrimary);
        setBrandAccentColor(resolvedAccent);
        setOrganisationId(resolvedOrganisationId);
        if (resolvedOrganisationId) {
          cacheResponderBranding({
            id: resolvedOrganisationId,
            name: legalName,
            displayName: resolvedName,
            logoUrl: resolvedLogo,
            primaryColor: resolvedPrimary,
            accentColor: resolvedAccent,
            branchName: resolvedBranchName,
          });
        }
        setCanDispatch(["owner", "admin", "manager", "dispatcher"].includes(body?.memberships?.[0]?.role ?? ""));
        setSupportContacts([...(body?.supportContacts?.organisation ?? []), ...(body?.supportContacts?.global ?? [])]);
        const ownPresence = (body?.responderPresence ?? []).find((row: any) => row.user_id === user.id);
        setSelfAvailability(typeof ownPresence?.availability === "string" ? ownPresence.availability : null);
        setSelfResponseStatus(typeof body?.currentResponseStatus === "string" ? body.currentResponseStatus : null);
      } catch (failure) {
        console.error("Responder organisation load failed", failure);
        if (active) {
          const cached = readCachedResponderBranding(initialBranding.id);
          if (cached) {
            setOrganisationId(cached.id);
            setOrganisationName(cached.name);
            setOrganisationDisplayName(cached.displayName);
            setOrganisationLogo(cached.logoUrl);
            setBranchName(cached.branchName);
            setBrandPrimaryColor(cached.primaryColor);
            setBrandAccentColor(cached.accentColor);
          }
          setOrganisationLoadError("Organisation details couldn’t be loaded. Check your connection and retry.");
        }
      } finally {
        if (active) setOrganisationLoading(false);
      }
    })();
    return () => { active = false; };
  }, [initialBranding.id, organisationLoadAttempt]);

  useEffect(() => {
    if (!organisationId) return;
    const client = createClient();
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;
    void client.auth.getUser().then(({ data: { user } }) => {
      if (!active || !user) return;
      channel = client.channel(`responder-availability-${user.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "responder_presence",
          filter: `user_id=eq.${user.id}`,
        }, (payload) => {
          const next = (payload.new as { availability?: unknown }).availability;
          if (active && typeof next === "string") setSelfAvailability(next);
        })
        .subscribe();
    });
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [organisationId]);

  useEffect(() => {
    if (!organisationId || !selfUserId) return;
    const client = createClient();
    let active = true;
    const channel = client.channel(`responder-current-response-${selfUserId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "alert_assignments",
        filter: `organisation_id=eq.${organisationId}`,
      }, () => {
        void (async () => {
          try {
            const response = await fetch("/api/organisation/me", { cache: "no-store" });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error ?? "Current response status could not be refreshed.");
            if (active) {
              setSelfResponseStatus(typeof body?.currentResponseStatus === "string" ? body.currentResponseStatus : null);
              setStatusRefreshError("");
            }
          } catch (failure) {
            console.error("Responder current status refresh failed", failure);
            if (active) setStatusRefreshError("Current status could not be refreshed.");
          }
        })();
      })
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [organisationId, selfUserId]);

  useEffect(() => {
    const selectFromNotification = (alertId: string) => {
      setSelectedId(alertId);
      setDetailCleared(false);
      setTab("all");
      setResponderView("alerts");
    };
    const onNotificationAlert = (event: Event) => {
      const alertId = (event as CustomEvent<{ alertId?: unknown }>).detail?.alertId;
      if (typeof alertId === "string") selectFromNotification(alertId);
    };
    const alertId = new URLSearchParams(window.location.search).get("alertId");
    if (alertId) {
      selectFromNotification(alertId);
      window.history.replaceState({}, "", window.location.pathname);
    }
    window.addEventListener("basteon:select-alert", onNotificationAlert);
    return () => window.removeEventListener("basteon:select-alert", onNotificationAlert);
  }, []);

  async function updateSelfAvailability(next: string) {
    if (!organisationId) return;
    setAvailabilityBusy(true);
    setAvailabilityError("");
    try {
      const response = await fetch("/api/organisation/responders/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, availability: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Availability could not be saved.");
      setSelfAvailability(body.availability);
    } catch (failure) {
      setAvailabilityError(failure instanceof Error ? failure.message : "Availability could not be saved.");
    } finally {
      setAvailabilityBusy(false);
    }
  }

  const active = useMemo(
    () => alerts.filter((a) => activeStatuses.includes(a.status) && !dismissedAlertIds.has(a.id)),
    [alerts, dismissedAlertIds],
  );
  const recentAlerts = useMemo(
    () => [...alerts].sort((a, b) => +new Date(b.triggered_at) - +new Date(a.triggered_at)).slice(0, 6),
    [alerts],
  );
  const unacked = useMemo(
    () =>
      active
        .filter((a) => a.status === "new")
        .sort((a, b) => +new Date(a.triggered_at) - +new Date(b.triggered_at)),
    [active],
  );

  const selectAlert = (alert: Alert) => {
    if (mobileAlertPane !== "detail") setMobileReturnPane(mobileAlertPane);
    setSelectedId(alert.id);
    setDetailCleared(false);
    setMobileAlertPane("detail");
  };
  const selected = detailCleared
    ? null
    : selectedId
      ? alerts.find((a) => a.id === selectedId) ?? null
      : null;

  const trail = useAlertTrail(selected?.id ?? null);

  const displayed = useMemo(
    () =>
      [...(tab === "active" ? active : alerts)]
        .filter((alert) => typeFilter === "all" || ((alert.type_code === "sos" ? "general" : alert.type_code) ?? "general") === typeFilter)
        .filter((alert) => !movingOnly || isMovingAlert(alert))
        .sort((a, b) =>
        a.status === "new" && b.status !== "new" ? -1
        : b.status === "new" && a.status !== "new" ? 1
        : +new Date(b.triggered_at) - +new Date(a.triggered_at),
      ),
    [alerts, active, tab, typeFilter, movingOnly],
  );

  async function dismissAlert(alert: Alert) {
    const confirmed = await confirm(
      "This removes the alert from your active queue only. It stays active for other responders and remains available in All. Any response you have accepted will continue.",
      { title: "Remove alert from your active queue?", confirmLabel: "Remove from active", danger: true },
    );
    if (!confirmed) return;
    try {
      const response = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: alert.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(result.error === "closed_alert"
          ? "This alert has already been closed."
          : result.error === "forbidden"
            ? "You cannot remove an alert outside your dispatch area."
            : "The alert could not be removed from your active queue.");
        return;
      }
      setDismissedAlertIds((current) => new Set(current).add(alert.id));
      if (selectedId === alert.id) {
        setSelectedId(null);
        setDetailCleared(true);
        setMobileAlertPane("queue");
      }
      toast.success("Alert removed from your active queue. It remains active for other responders.");
    } catch {
      toast.error("Could not reach the alert service. Try again.");
    }
  }

  const showOrgBrand = Boolean(organisationLogo && logoLoadFailedUrl !== organisationLogo);
  const themeStyle = brandCssProperties(brandPrimaryColor, brandAccentColor);
  const mobileSessionDetail = showOrgBrand
    ? [operatorName, branchName].filter(Boolean).join(" · ")
    : [organisationName || "Response console", operatorName].filter(Boolean).join(" · ");

  return (
    <div
      className={`responder-console ${styles.responderRoot} h-screen grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg)]`}
      data-branded={showOrgBrand ? "true" : "false"}
      style={themeStyle}
    >
      <Navbar
        brandClassName={styles.brandBox}
        brandMark={showOrgBrand
          ? <img className={styles.organisationBrandLogo} src={organisationLogo ?? ""} alt="" onError={() => setLogoLoadFailedUrl(organisationLogo)} />
          : <BasteonBrand markOnly />}
        brandWordmark={showOrgBrand
            ? <span className={styles.organisationBrandWordmark} title={organisationDisplayName}>{organisationDisplayName}</span>
          : <BasteonBrand variant="dark" wordmarkOnly />}
        beforeSpacer={organisationName ? (
          <div className={styles.headerOrganisation}>
            {showOrgBrand
              ? <span>Operator <b>{operatorName || "Responder"}</b>{branchName && <> · {branchName}</>}</span>
              : <>
                  {organisationLogo && logoLoadFailedUrl !== organisationLogo
                    ? <img src={organisationLogo} alt="" onError={() => setLogoLoadFailedUrl(organisationLogo)} />
                    : <i>{organisationName.slice(0, 2).toUpperCase()}</i>}
                  <span>{organisationName}{operatorName && <> · Operator <b>{operatorName}</b></>}</span>
                </>}
          </div>
        ) : null}
      >
        <ConnectionIndicator state={connection} />
        <NotificationBell />
        <SoundToggle />
      </Navbar>
      <div className={styles.mobileSessionBar}>
        <LockKeyhole size={14} aria-hidden="true" />
        <span><b>Secure session</b><small>{mobileSessionDetail ? `· ${mobileSessionDetail}` : ""}</small></span>
      </div>

      <main className={styles.shell}>
        <div className={styles.navRail} role="tablist" aria-label="Responder console sections">
          <button type="button" role="tab" aria-selected={responderView === "alerts" && mobileAlertPane !== "map" && !(mobileAlertPane === "detail" && mobileReturnPane === "map")} className={styles.navButton} onClick={() => { setResponderView("alerts"); setMobileAlertPane("queue"); }}>
            <AlertTriangle size={19} /><span>Alerts</span>
            {unacked.length > 0 && <b className={styles.navCount}>{unacked.length > 9 ? "9+" : unacked.length}</b>}
          </button>
          <button type="button" role="tab" aria-selected={responderView === "alerts" && (mobileAlertPane === "map" || (mobileAlertPane === "detail" && mobileReturnPane === "map"))} className={`${styles.navButton} ${styles.mobileMapNav}`} onClick={() => { setResponderView("alerts"); setMobileAlertPane("map"); }}>
            <MapIcon size={19} /><span>Map</span>
          </button>
          <button type="button" role="tab" aria-selected={responderView === "overview"} className={styles.navButton} onClick={() => setResponderView("overview")}>
            <LayoutDashboard size={19} /><span>Overview</span>
          </button>
          <button type="button" role="tab" aria-selected={responderView === "settings"} className={styles.navButton} onClick={() => setResponderView("settings")}>
            <Settings size={19} /><span>Settings</span>
          </button>
        </div>

        <div className={styles.mainContent}>
          <ResponderLocationPublisher position={position} organisationId={organisationId} />
          {!organisationId && !organisationLoading && (
            <div className={styles.notice} role={organisationLoadError ? "alert" : "status"}>
              {organisationLoadError
                ? <>{organisationLoadError} <button type="button" onClick={() => setOrganisationLoadAttempt((attempt) => attempt + 1)}>Retry</button></>
                : organisationBlocked
                  ? "Your organisation is currently suspended. Alert and telemetry access is hidden."
                  : "This responder account is not linked to an active organisation. Alert and telemetry access is hidden until linked."}
            </div>
          )}
          {alertError && <div className={`${styles.notice} ${styles.errorNotice}`} role="alert">Alert stream degraded — {alertError}</div>}

          {responderView === "alerts" && (
            <section className={styles.alertsLayout} data-mobile-pane={mobileAlertPane} aria-label="Incident dispatch">
              <aside id="responder-queue" className={styles.queue} aria-label="Incident queue">
                <header className={styles.queueHeader}>
                  <h1>Incident queue</h1>
                  <span>{active.length} active</span>
                </header>
                <div className={styles.queueTabs} role="tablist" aria-label="Incident filter">
                  <button type="button" role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>Active <b>{active.length}</b></button>
                  <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>All <b>{alerts.length}</b></button>
                </div>
                <div className={styles.queueFilters}>
                  <label className="sr-only" htmlFor="responder-type-filter">Filter by alert type</label>
                  <select id="responder-type-filter" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    <option value="all">All alert types</option>
                    {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
                  </select>
                  <label><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} /> Moving only</label>
                </div>
                <div className={styles.queueList}>
                  <AlertList alerts={displayed} selected={selected?.id ?? null} me={position} onSelect={selectAlert} onDismiss={(alert) => void dismissAlert(alert)} dismissedIds={dismissedAlertIds} relativeTimeNow={serverNow} />
                </div>
                {error && <div className={styles.gpsNotice} role="status">
                  <span>GPS · {error}</span>
                  <button type="button" disabled={refreshingLocation} onClick={() => void refreshLocation()}>
                    {refreshingLocation ? "Checking…" : "Retry location"}
                  </button>
                </div>}
              </aside>

              <section id="responder-map" className={styles.mapArea} aria-label="Incident map">
                <div className={styles.mapCanvas}>
                  <AlertMap
                    selected={selected}
                    me={position}
                    trail={trail}
                    baseLayer={mapBaseLayer}
                    recenterToken={mapRecenterToken}
                    showFollowButton={false}
                    onSelect={selectAlert}
                  />
                </div>
                <div className={styles.mapControls}>
                  <div className={styles.mapTiles} role="group" aria-label="Map tiles">
                    {MAP_BASE_LAYERS.map(({ name }) => {
                      const LayerIcon = MAP_LAYER_ICONS[name];
                      return (
                        <button key={name} type="button" aria-label={name} title={name} aria-pressed={mapBaseLayer === name} onClick={() => setMapBaseLayer(name)}>
                          <LayerIcon className={styles.mapLayerIcon} size={18} aria-hidden="true" />
                          <span className={styles.mapLayerLabel}>{name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className={styles.recenterButton} onClick={() => setMapRecenterToken((token) => token + 1)}>
                    <LocateFixed size={16} />Re-center
                  </button>
                </div>
              </section>

              <aside id="responder-detail" className={styles.detailPanel} aria-label="Incident detail">
                <button type="button" className={styles.mobileDetailBack} onClick={() => setMobileAlertPane(mobileReturnPane)}>
                  <ArrowLeft size={17} aria-hidden="true" /> Back to {mobileReturnPane === "map" ? "map" : "alerts"}
                </button>
                <AlertDetailPanel
                  alert={selected}
                  events={events}
                  refresh={refresh}
                  organisationId={organisationId}
                  canDispatch={canDispatch}
                  onViewProfile={(alert) => setProfile(alert.device?.owner ?? null)}
                  onClear={() => { setSelectedId(null); setDetailCleared(true); setMobileAlertPane("queue"); }}
                />
              </aside>
            </section>
          )}

          {responderView === "overview" && (
            <section className={styles.pageView}>
              <div className={styles.pageViewInner}>
                <header className={styles.pageTitle}>
                  <div><h1>Responder overview</h1><p>{organisationName || "Response console"} · updated live</p></div>
                  <button type="button" className={styles.actionButton} onClick={() => { setMobileAlertPane("queue"); setResponderView("alerts"); }}>Open alerts</button>
                </header>
                <div className={styles.stats}>
                  <article className={styles.statHot}><span>Needs a response now</span><b>{unacked.length}</b><small>{unacked.length} unacknowledged {unacked.length === 1 ? "alert" : "alerts"} in the queue</small></article>
                  <article><span>Active alerts</span><b>{active.length}</b><small>Currently open</small></article>
                  <article><span>Total alerts</span><b>{alerts.length}</b><small>All time</small></article>
                </div>
                <div className={styles.overviewGrid}>
                  <section className={styles.overviewBlock}>
                    <header><h2>Latest alerts</h2><button type="button" onClick={() => { setMobileAlertPane("map"); setResponderView("alerts"); }}>View on map</button></header>
                    {recentAlerts.length > 0 ? (
                      <div className={styles.overviewTableWrap}>
                        <table className={styles.overviewTable}>
                          <thead><tr><th>Alert</th><th>Person</th><th>Age</th></tr></thead>
                          <tbody>{recentAlerts.map((alert) => (
                            <tr key={alert.id}>
                              <td><button type="button" onClick={() => { selectAlert(alert); setResponderView("alerts"); }}><AlertTypeBadge typeCode={alert.type_code} />{alertDeviceLabel(alert)}</button></td>
                              <td>{alertOwnerName(alert) ?? "Unassigned"}</td>
                              <td>{fmtRelativeTime(alert.triggered_at, serverNow)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    ) : null}
                    {recentAlerts.length > 0 ? (
                      <div className={styles.mobileOverviewAlerts}>
                        {recentAlerts.map((alert) => (
                          <button key={alert.id} type="button" className={styles.mobileOverviewAlert} onClick={() => { selectAlert(alert); setResponderView("alerts"); }}>
                            <span className={styles.mobileOverviewAlertMeta}>
                              <AlertTypeBadge typeCode={alert.type_code} />
                              <time>{fmtRelativeTime(alert.triggered_at, serverNow)}</time>
                            </span>
                            <strong>{alertDeviceLabel(alert)}</strong>
                            <span className={styles.mobileOverviewAlertOwner}>{alertOwnerName(alert) ?? "Unassigned"}</span>
                            <span className={styles.mobileOverviewAlertStatus}>{alert.status.replaceAll("_", " ")}</span>
                          </button>
                        ))}
                      </div>
                    ) : <p className={styles.emptyOverview}>No alerts have been reported.</p>}
                  </section>
                  <section className={styles.overviewBlock}>
                    <header><h2>Response progress</h2></header>
                    <div className={styles.progressStats}>
                      <div><b>{active.filter((alert) => ["acknowledged", "enroute", "on_scene"].includes(alert.status)).length}</b><span>Acknowledged</span></div>
                      <div><b>{active.filter((alert) => ["enroute", "on_scene"].includes(alert.status)).length}</b><span>On the way</span></div>
                      <div><b>{active.filter((alert) => alert.status === "on_scene").length}</b><span>On scene</span></div>
                    </div>
                    <p>Full incident timelines remain live in the Alerts view.</p>
                  </section>
                  <section className={styles.overviewBlock}>
                    <header><h2>System status</h2><ConnectionIndicator state={connection} /></header>
                    <div className={styles.systemStatus}>
                      <div><i data-state={connection === "live" ? "ok" : "wait"} /><span>Live alert feed</span><b>{connection === "live" ? "Connected" : "Reconnecting"}</b></div>
                      <div><i data-state={position ? "ok" : error ? "warn" : "wait"} /><span>Responder location</span><b>{position ? "Sharing" : error ? "Needs attention" : "Waiting"}</b></div>
                    </div>
                  </section>
                </div>
              </div>
            </section>
          )}

          {responderView === "settings" && (
            <section className={styles.pageView}>
              <div className={styles.pageViewInner}>
                <header className={styles.pageTitle}><div><h1>Responder settings &amp; support</h1><p>Manage your availability and support contacts.</p></div></header>
                <section className={styles.settingsBlock}>
                  <header><h2>Your availability</h2></header>
                  <div className={styles.settingsBody}>
                    <div className={styles.availabilityOptions}>
                      {["available", "busy", "off_duty", "unavailable"].map((value) => (
                        <button key={value} type="button" aria-pressed={selfAvailability === value} disabled={!organisationId || availabilityBusy || selfAvailability === value} onClick={() => void updateSelfAvailability(value)}>{value.replaceAll("_", " ")}</button>
                      ))}
                    </div>
                    {availabilityError && <p className={styles.settingsError} role="alert">{availabilityError}</p>}
                    <p className={styles.currentAvailability} role="status">
                      Current status: <b>{formatCurrentResponderStatus(selfResponseStatus ?? selfAvailability) ?? (organisationLoading ? "Loading…" : "Not reported")}</b>
                    </p>
                    {statusRefreshError && <p className={styles.settingsError} role="alert">{statusRefreshError}</p>}
                  </div>
                </section>
                <section className={styles.settingsBlock}>
                  <header><h2>Support contacts</h2></header>
                  <div className={`${styles.supportContacts} tbl-wrap`}>
                    <table className="tbl">
                      <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Purpose</th></tr></thead>
                      <tbody>
                        {supportContacts.map((contact) => (
                          <tr key={contact.id}>
                            <td data-label="Name">{contact.contact_name}</td><td data-label="Type">{contact.contact_type}</td><td data-label="Value">{contact.contact_value}</td><td data-label="Purpose">{contact.purpose}</td>
                          </tr>
                        ))}
                        {supportContacts.length === 0 && <tr><td colSpan={4} className="muted text-center">No support contacts available.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className={styles.settingsBlock}>
                  <header><h2>Secure session</h2></header>
                  <div className={styles.sessionCard}>
                    <span><LockKeyhole size={18} aria-hidden="true" /></span>
                    <div><b>{operatorName || "Responder"}</b><small>{organisationName || "Response console"} · Actions are logged</small></div>
                    <button type="button" onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); }}>
                      <LogOut size={17} aria-hidden="true" /> Sign out
                    </button>
                  </div>
                </section>
                <footer className={styles.poweredBy}>Powered by Basteon</footer>
              </div>
            </section>
          )}
        </div>

        <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
      </main>
    </div>
  );
}