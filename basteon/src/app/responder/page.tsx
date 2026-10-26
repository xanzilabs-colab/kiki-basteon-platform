"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
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
import { NotificationBell } from "@/components/NotificationBell";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import { useAppDialog } from "@/components/AppDialogProvider";
import type { Alert, ProfileContact } from "@/lib/types";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { createClient } from "@/lib/supabase/client";
import { fmtRelativeTime } from "@/lib/datetime";
import { isMovingAlert } from "@/lib/motion";
import { MAP_BASE_LAYERS } from "@/lib/mapLayers";
import { formatCurrentResponderStatus } from "@/lib/currentResponderStatus";
import { AlertTriangle, LayoutDashboard, LocateFixed, Settings } from "lucide-react";
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

export default function ResponderPage() {
  const [responderView, setResponderView] = useState<"alerts" | "overview" | "settings">("alerts");
  const [organisationId, setOrganisationId] = useState("");
  const [organisationLoading, setOrganisationLoading] = useState(true);
  const [organisationLoadError, setOrganisationLoadError] = useState("");
  const [organisationLoadAttempt, setOrganisationLoadAttempt] = useState(0);
  const [organisationBlocked, setOrganisationBlocked] = useState(false);
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts();
  const serverNow = useServerNow();
  const { confirm } = useAppDialog();
  const { position, error } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCleared, setDetailCleared] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
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
  const [selfAvailability, setSelfAvailability] = useState<string | null>(null);
  const [selfResponseStatus, setSelfResponseStatus] = useState<string | null>(null);
  const [selfUserId, setSelfUserId] = useState("");
  const [statusRefreshError, setStatusRefreshError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [supportContacts, setSupportContacts] = useState<Array<any>>([]);
  const emergencyTypes = useEmergencyTypes();

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
        if (body?.blocked?.isBlocked) {
          setOrganisationName(body?.organisation?.name ?? "");
          setOrganisationLogo(body?.organisation?.logo_url ?? null);
          setOrganisationId("");
          setSelfAvailability(null);
          setSelfResponseStatus(null);
          return;
        }
        setOrganisationName(body?.organisation?.name ?? "");
        setOrganisationLogo(body?.organisation?.logo_url ?? null);
        setOrganisationId(body?.organisation?.id ?? "");
        setCanDispatch(["owner", "admin", "manager", "dispatcher"].includes(body?.memberships?.[0]?.role ?? ""));
        setSupportContacts([...(body?.supportContacts?.organisation ?? []), ...(body?.supportContacts?.global ?? [])]);
        const ownPresence = (body?.responderPresence ?? []).find((row: any) => row.user_id === user.id);
        setSelfAvailability(typeof ownPresence?.availability === "string" ? ownPresence.availability : null);
        setSelfResponseStatus(typeof body?.currentResponseStatus === "string" ? body.currentResponseStatus : null);
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
    setSelectedId(alert.id);
    setDetailCleared(false);
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
      }
      toast.success("Alert removed from your active queue. It remains active for other responders.");
    } catch {
      toast.error("Could not reach the alert service. Try again.");
    }
  }

  return (
    <div className={`responder-console ${styles.responderRoot} h-screen grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg)]`}>
      <Navbar
        brandClassName={styles.brandBox}
        brandMark={<svg viewBox="0 0 32 32" aria-hidden="true" className={styles.brandMark}><path d="M5 3h22v17l-11 9-11-9z" /><path d="M12 10h5a3 3 0 0 1 0 6h-5zm0 6h6a3 3 0 0 1 0 6h-6z" className={styles.brandMarkCutout} /></svg>}
        beforeSpacer={organisationName ? (
          <div className={styles.headerOrganisation}>
            {organisationLogo ? <img src={organisationLogo} alt="" /> : <i>{organisationName.slice(0, 2).toUpperCase()}</i>}
            <span>{organisationName}{operatorName && <> · Operator <b>{operatorName}</b></>}</span>
          </div>
        ) : null}
      >
        <ConnectionIndicator state={connection} />
        <NotificationBell />
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
                  <AlertList alerts={displayed} selected={selected?.id ?? null} me={position} onSelect={selectAlert} onDismiss={(alert) => void dismissAlert(alert)} dismissedIds={dismissedAlertIds} relativeTimeNow={serverNow} />
                </div>
                {error && <div className={styles.gpsNotice} role="status">GPS · {error}</div>}
              </aside>

              <section className={styles.mapArea} aria-label="Incident map">
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
                    {MAP_BASE_LAYERS.map(({ name }) => (
                      <button key={name} type="button" aria-pressed={mapBaseLayer === name} onClick={() => setMapBaseLayer(name)}>{name}</button>
                    ))}
                  </div>
                  <button type="button" className={styles.recenterButton} onClick={() => setMapRecenterToken((token) => token + 1)}>
                    <LocateFixed size={16} />Re-center
                  </button>
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
                    <p className={styles.currentAvailability} role="status">
                      Current status: <b>{formatCurrentResponderStatus(selfResponseStatus ?? selfAvailability) ?? (organisationLoading ? "Loading…" : "Not reported")}</b>
                    </p>
                    {statusRefreshError && <p className={styles.settingsError} role="alert">{statusRefreshError}</p>}
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