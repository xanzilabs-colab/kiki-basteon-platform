"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { activeStatuses } from "@/lib/status";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { useAlertTrail } from "@/hooks/useAlertTrail";
import { useGeolocation } from "@/hooks/useGeolocation";
import { AlertList } from "@/components/AlertList";
import { AlertDetailPanel } from "@/components/AlertDetailPanel";
import { ResponderLocationPublisher } from "@/components/ResponderLocationPublisher";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { SoundToggle } from "@/components/SoundToggle";
import { Navbar } from "@/components/Navbar";
import { NotificationBell } from "@/components/NotificationBell";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import type { Alert, ProfileContact } from "@/lib/types";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { createClient } from "@/lib/supabase/client";
import { isMovingAlert } from "@/lib/motion";
import { MAP_BASE_LAYERS } from "@/lib/mapLayers";
import { AlertTriangle, Building2, LayoutDashboard, LocateFixed, Settings } from "lucide-react";
import styles from "./ResponderDashboard.module.css";

const AlertMap = dynamic(() => import("@/components/AlertMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center">
      <span className="label">Initialising map…</span>
    </div>
  ),
});

export default function ResponderPage() {
  const [responderView, setResponderView] = useState<"alerts" | "overview" | "settings">("alerts");
  const [organisationId, setOrganisationId] = useState("");
  const [organisationLoading, setOrganisationLoading] = useState(true);
  const [organisationLoadError, setOrganisationLoadError] = useState("");
  const [organisationLoadAttempt, setOrganisationLoadAttempt] = useState(0);
  const [organisationBlocked, setOrganisationBlocked] = useState(false);
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts();
  const { position, error } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCleared, setDetailCleared] = useState(false);
  const [tab, setTab] = useState<"active" | "all">("active");
  const [profile, setProfile] = useState<ProfileContact | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [organisationLogo, setOrganisationLogo] = useState<string | null>(null);
  const [canDispatch, setCanDispatch] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [movingOnly, setMovingOnly] = useState(false);
  const [mapBaseLayer, setMapBaseLayer] = useState<(typeof MAP_BASE_LAYERS)[number]["name"]>("Street");
  const [mapRecenterToken, setMapRecenterToken] = useState(0);
  const [selfAvailability, setSelfAvailability] = useState("off_duty");
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [supportContacts, setSupportContacts] = useState<Array<any>>([]);
  const emergencyTypes = useEmergencyTypes();

  useEffect(() => {
    let active = true;
    void (async () => {
      setOrganisationLoading(true);
      setOrganisationLoadError("");
      try {
        const client = createClient();
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw new Error("Your session could not be verified.");
        const { data: profileRow } = await client.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
        if (active) setOperatorName(profileRow?.full_name ?? user.email ?? "Responder");
        const response = await fetch("/api/organisation/me", { cache: "no-store" });
        if (response.status === 403) {
          if (active) {
            setOrganisationId("");
            setOrganisationName("");
            setOrganisationBlocked(false);
          }
          return;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Organisation details could not be loaded.");
        if (!active) return;
        setOrganisationBlocked(Boolean(body?.blocked?.isBlocked));
        if (body?.blocked?.isBlocked) {
          setOrganisationName(body?.organisation?.name ?? "");
          setOrganisationLogo(body?.organisation?.logo_url ?? null);
          setOrganisationId("");
          return;
        }
        setOrganisationName(body?.organisation?.name ?? "");
        setOrganisationLogo(body?.organisation?.logo_url ?? null);
        setOrganisationId(body?.organisation?.id ?? "");
        setCanDispatch(["owner", "admin", "manager", "dispatcher"].includes(body?.memberships?.[0]?.role ?? ""));
        setSupportContacts([...(body?.supportContacts?.organisation ?? []), ...(body?.supportContacts?.global ?? [])]);
        const ownPresence = (body?.responderPresence ?? []).find((row: any) => row.user_id === user.id);
        if (ownPresence?.availability) setSelfAvailability(ownPresence.availability);
      } catch (failure) {
        console.error("Responder organisation load failed", failure);
        if (active) setOrganisationLoadError("Organisation details couldn’t be loaded. Check your connection and retry.");
      } finally {
        if (active) setOrganisationLoading(false);
      }
    })();
    return () => { active = false; };
  }, [organisationLoadAttempt]);

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
    () => alerts.filter((a) => activeStatuses.includes(a.status)),
    [alerts],
  );
  const latestAlert = useMemo(
    () => [...alerts].sort((a, b) => +new Date(b.triggered_at) - +new Date(a.triggered_at))[0] ?? null,
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
    setSelectedId(alert.id);
    setDetailCleared(false);
  };
  const selected = detailCleared
    ? null
    : selectedId
      ? alerts.find((a) => a.id === selectedId) ?? null
      : unacked[0] ?? active[0] ?? null;

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

  return (
    <div className="responder-console h-screen grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg)]">
      <Navbar>
        {organisationName && (
          <div className={styles.headerOrganisation}>
            {organisationLogo
              ? <img src={organisationLogo} alt="" />
              : <span><Building2 size={14} /></span>}
            <div>
              <b>{organisationName}</b>
              {operatorName && <small>Operator · {operatorName}</small>}
            </div>
          </div>
        )}
        <NotificationBell />
        <ConnectionIndicator state={connection} />
        <SoundToggle />
      </Navbar>

      <main className={styles.shell}>
        <div className={styles.navRail} role="tablist" aria-label="Responder console sections">
          <button type="button" role="tab" aria-selected={responderView === "alerts"} className={styles.navButton} onClick={() => setResponderView("alerts")}>
            <AlertTriangle size={19} /><span>Alerts</span>
            {unacked.length > 0 && <b className={styles.navCount}>{unacked.length > 9 ? "9+" : unacked.length}</b>}
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
            <section className={styles.alertsLayout} aria-label="Incident dispatch">
              <aside className={styles.queue} aria-label="Incident queue">
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
                  <AlertList alerts={displayed} selected={selected?.id ?? null} me={position} onSelect={selectAlert} />
                </div>
                {error && <div className={styles.gpsNotice} role="status">GPS · {error}</div>}
              </aside>

              <section className={styles.mapArea} aria-label="Incident map">
                <div className={styles.mapCanvas}>
                  <AlertMap
                    alerts={active}
                    selected={selected}
                    me={position}
                    trail={trail}
                    baseLayer={mapBaseLayer}
                    recenterToken={mapRecenterToken}
                    onSelect={selectAlert}
                  />
                </div>
                <div className={styles.mapControls}>
                  <div className={styles.mapTiles} role="group" aria-label="Map tiles">
                    {MAP_BASE_LAYERS.map(({ name }) => (
                      <button key={name} type="button" aria-pressed={mapBaseLayer === name} onClick={() => setMapBaseLayer(name)}>{name}</button>
                    ))}
                  </div>
                  <button type="button" className={styles.recenterButton} onClick={() => setMapRecenterToken((token) => token + 1)}>
                    <LocateFixed size={16} />Re-center
                  </button>
                </div>
                <div className={styles.mapStatus} aria-live="polite">
                  <i className={connection === "live" ? styles.liveDot : styles.waitingDot} />
                  {connection === "live" ? "Live incident map" : connection === "reconnecting" ? "Reconnecting to live updates" : "Connecting to live updates"}
                </div>
              </section>

              <aside className={styles.detailPanel} aria-label="Incident detail">
                <AlertDetailPanel
                  alert={selected}
                  events={events}
                  refresh={refresh}
                  organisationId={organisationId}
                  canDispatch={canDispatch}
                  onViewProfile={(alert) => setProfile(alert.device?.owner ?? null)}
                  onClear={() => { setSelectedId(null); setDetailCleared(true); }}
                />
              </aside>
            </section>
          )}

          {responderView === "overview" && (
            <section className={styles.pageView}>
              <div className={styles.pageViewInner}>
                <header className={styles.pageTitle}>
                  <div><h1>Responder overview</h1><p>{organisationName || "Response console"} · updated live</p></div>
                  <button type="button" className={styles.actionButton} onClick={() => setResponderView("alerts")}>Open alerts</button>
                </header>
                <div className={styles.stats}>
                  <article className={styles.statHot}><span>Needs a response now</span><b>{unacked.length}</b><small>{unacked.length} unacknowledged {unacked.length === 1 ? "alert" : "alerts"} in the queue</small></article>
                  <article><span>Active alerts</span><b>{active.length}</b><small>Currently open</small></article>
                  <article><span>Total alerts</span><b>{alerts.length}</b><small>All time</small></article>
                </div>
                <div className={styles.overviewGrid}>
                  <section className={styles.overviewBlock}>
                    <header><h2>Latest alert</h2><button type="button" onClick={() => setResponderView("alerts")}>View on map</button></header>
                    {latestAlert ? (
                      <button type="button" className={styles.latestAlert} onClick={() => { selectAlert(latestAlert); setResponderView("alerts"); }}>
                        <span>{latestAlert.device?.device_name || "Safety alert"}</span>
                        <span>{latestAlert.device?.owner?.full_name || "Caller"}</span>
                        <span>{new Date(latestAlert.triggered_at).toLocaleString()}</span>
                      </button>
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
                    <p className={styles.currentAvailability} role="status">Current status: <b>{selfAvailability.replaceAll("_", " ")}</b></p>
                  </div>
                </section>
                <section className={styles.settingsBlock}>
                  <header><h2>Support contacts</h2></header>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Purpose</th></tr></thead>
                      <tbody>
                        {supportContacts.map((contact) => (
                          <tr key={contact.id}>
                            <td>{contact.contact_name}</td><td>{contact.contact_type}</td><td>{contact.contact_value}</td><td>{contact.purpose}</td>
                          </tr>
                        ))}
                        {supportContacts.length === 0 && <tr><td colSpan={4} className="muted text-center">No support contacts available.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          )}
        </div>

        <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
      </main>
    </div>
  );
}