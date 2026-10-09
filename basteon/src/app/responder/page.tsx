"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { activeStatuses } from "@/lib/status";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { useAlertTrail } from "@/hooks/useAlertTrail";
import { useGeolocation } from "@/hooks/useGeolocation";
import { AlertList } from "@/components/AlertList";
import { AlertDetailPanel } from "@/components/AlertDetailPanel";
import { AlertBanner } from "@/components/AlertBanner";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { SoundToggle } from "@/components/SoundToggle";
import { Navbar } from "@/components/Navbar";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import type { Alert, ProfileContact } from "@/lib/types";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";
import { createClient } from "@/lib/supabase/client";
import { isMovingAlert } from "@/lib/motion";

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
  const scopedOrganisationIds = useMemo(() => organisationId ? [organisationId] : [], [organisationId]);
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts({ scopeOrganisationIds: scopedOrganisationIds });
  const { position, error } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "all">("active");
  const [profile, setProfile] = useState<ProfileContact | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [canDispatch, setCanDispatch] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [movingOnly, setMovingOnly] = useState(false);
  const [selfAvailability, setSelfAvailability] = useState("off_duty");
  const [supportContacts, setSupportContacts] = useState<Array<any>>([]);
  const emergencyTypes = useEmergencyTypes();

  useEffect(() => {
    void (async () => {
      const client = createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const { data: profileRow } = await client.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      setOperatorName(profileRow?.full_name ?? user.email ?? "Responder");
      const response = await fetch("/api/organisation/me", { cache: "no-store" });
      if (response.ok) {
        const body = await response.json();
        if (body?.blocked?.isBlocked) {
          setOrganisationName(body?.organisation?.name ?? "");
          setOrganisationId("");
          return;
        }
        setOrganisationName(body?.organisation?.name ?? "");
        setOrganisationId(body?.organisation?.id ?? "");
        setCanDispatch(["owner", "admin", "manager", "dispatcher"].includes(body?.memberships?.[0]?.role ?? ""));
        setSupportContacts([...(body?.supportContacts?.organisation ?? []), ...(body?.supportContacts?.global ?? [])]);
        const ownPresence = (body?.responderPresence ?? []).find((row: any) => row.user_id === user.id);
        if (ownPresence?.availability) setSelfAvailability(ownPresence.availability);
      }
    })();
  }, []);

  async function updateSelfAvailability(next: string) {
    if (!organisationId) return;
    const response = await fetch("/api/organisation/responders/availability", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationId, availability: next }),
    });
    if (!response.ok) return;
    setSelfAvailability(next);
  }

  const active = useMemo(
    () => alerts.filter((a) => activeStatuses.includes(a.status)),
    [alerts],
  );
  const unacked = useMemo(
    () =>
      active
        .filter((a) => a.status === "new")
        .sort((a, b) => +new Date(a.triggered_at) - +new Date(b.triggered_at)),
    [active],
  );

  const selected =
    alerts.find((a) => a.id === selectedId) ?? unacked[0] ?? active[0] ?? null;

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
    <div className="h-screen grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg)]">
      <Navbar>
        <ConnectionIndicator state={connection} />
        <SoundToggle />
      </Navbar>

      <main className="relative min-h-0 min-w-0">
        {!organisationId && (
          <div className="absolute z-[1200] left-3 right-3 top-3 md:left-[calc(var(--rail-l)+12px)] md:right-[calc(var(--rail-r)+12px)] panel border-l-4 border-[var(--warn)] px-3 py-2 text-[12px] text-[var(--warn)]">
            This responder account is not linked to an active organisation. Alert and telemetry access is hidden until linked.
          </div>
        )}
        <div className={`absolute z-[1100] left-3 right-3 ${organisationId ? "top-3" : "top-16"} md:left-[calc(var(--rail-l)+12px)] md:right-[calc(var(--rail-r)+12px)]`}>
          <div className="panel px-3 py-2 text-[12px] flex flex-wrap items-center gap-2">
            <span className="status status-blue">Responder Console</span>
            {organisationName && <span className="muted">Organisation: {organisationName}</span>}
            {operatorName && <span className="muted">Operator: {operatorName}</span>}
            <div className="ml-auto inline-flex gap-1 rounded border border-[var(--line)] bg-[var(--surface-2)] p-1">
              <button className="btn h-7 px-2 text-[11px]" aria-pressed={responderView === "alerts"} onClick={() => setResponderView("alerts")}>Alerts</button>
              <button className="btn h-7 px-2 text-[11px]" aria-pressed={responderView === "overview"} onClick={() => setResponderView("overview")}>Overview</button>
              <button className="btn h-7 px-2 text-[11px]" aria-pressed={responderView === "settings"} onClick={() => setResponderView("settings")}>Settings</button>
            </div>
          </div>
        </div>
        {alertError && (
          <div
            role="alert"
            className="absolute z-[1100] top-3 left-3 right-3
                       md:left-[calc(var(--rail-l)+12px)] md:right-3
                       lg:right-[calc(var(--rail-r)+12px)]
                       bg-[var(--surface-2)] border-l-4 border-[var(--crit)]
                       px-3 py-2 text-[12px] text-[var(--crit)] font-medium"
          >
            Alert stream degraded — {alertError}
          </div>
        )}

        {/* Base map fills the viewport behind everything */}
        <div className="absolute inset-0">
          <AlertMap
            alerts={active}
            selected={selected}
            me={position}
            trail={trail}
            onSelect={(a) => setSelectedId(a.id)}
          />
        </div>

        {responderView === "alerts" && (
          <AlertBanner
            count={unacked.length}
            oldest={unacked[0] ?? null}
            onJump={(a: Alert) => setSelectedId(a.id)}
          />
        )}

        {/* ── Left rail: Incident queue ─────────────────────────── */}
        {responderView === "alerts" && <aside
          aria-label="Incident queue"
          className="hidden md:flex absolute z-[1000] flex-col
                     panel
                     top-3 bottom-3 left-3 w-[var(--rail-l)]
                     max-h-[calc(100vh-var(--appbar)-24px)]"
        >
          <div className="pane-head">
            <span>Incident queue</span>
            <span
              className="data normal-case tracking-normal"
              style={{ color: "var(--text-2)", letterSpacing: 0 }}
            >
              {active.length} active
            </span>
          </div>

          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "active"}
              onClick={() => setTab("active")}
            >
              Active ({active.length})
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "all"}
              onClick={() => setTab("all")}
            >
              All ({alerts.length})
            </button>
          </div>

          <div className="px-3 pb-2 space-y-2"><label className="sr-only" htmlFor="responder-type-filter">Filter by alert type</label><select id="responder-type-filter" className="input h-8 text-[12px]" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All alert types</option>{emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}</select><label className="inline-flex items-center gap-2 text-[12px]"><input type="checkbox" checked={movingOnly} onChange={(event) => setMovingOnly(event.target.checked)} />Moving only</label></div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <AlertList
              alerts={displayed}
              selected={selected?.id ?? null}
              me={position}
              onSelect={(a: Alert) => setSelectedId(a.id)}
            />
          </div>

          {error && (
            <div className="px-3 py-2 border-t border-[var(--line)] text-[11px] data text-[var(--warn)]">
              GPS · {error}
            </div>
          )}
        </aside>}

        {/* ── Right rail: Incident detail ──────────────────────── */}
        {responderView === "alerts" && <aside
          aria-label="Incident detail"
          className="
            absolute z-[1000] panel flex flex-col min-h-0 overflow-hidden
            bottom-0 left-0 right-0 h-[52%] max-h-[52%]
            rounded-b-none
            lg:top-3 lg:bottom-3 lg:left-auto lg:right-3
            lg:w-[var(--rail-r)] lg:h-auto lg:max-h-none lg:rounded-b-md
          "
        >
          <AlertDetailPanel
            alert={selected}
            events={events}
            refresh={refresh}
            organisationId={organisationId}
            canDispatch={canDispatch}
            onViewProfile={(alert) => setProfile(alert.device?.owner ?? null)}
          />
        </aside>}

        {responderView === "overview" && (
          <section className="absolute z-[1000] left-3 right-3 top-24 panel p-4 space-y-3 md:left-[calc(var(--rail-l)+12px)] md:right-[calc(var(--rail-r)+12px)]">
            <h2 className="pane-head">Responder overview</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="panel p-3"><p className="muted text-xs">Active alerts</p><p className="text-xl font-bold">{active.length}</p></div>
              <div className="panel p-3"><p className="muted text-xs">Unacknowledged</p><p className="text-xl font-bold">{unacked.length}</p></div>
              <div className="panel p-3"><p className="muted text-xs">Total alerts</p><p className="text-xl font-bold">{alerts.length}</p></div>
            </div>
            <p className="muted text-xs">Timeline and response progress remain live in the Alerts tab.</p>
          </section>
        )}

        {responderView === "settings" && (
          <section className="absolute z-[1000] left-3 right-3 top-24 panel p-4 space-y-3 md:left-[calc(var(--rail-l)+12px)] md:right-[calc(var(--rail-r)+12px)]">
            <h2 className="pane-head">Responder settings & support</h2>
            <div>
              <p className="muted text-xs mb-2">Your availability</p>
              <div className="flex flex-wrap gap-2">
                {["available", "busy", "off_duty", "unavailable"].map((value) => (
                  <button key={value} className="btn" disabled={!organisationId || selfAvailability === value} onClick={() => void updateSelfAvailability(value)}>{value}</button>
                ))}
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Purpose</th></tr></thead>
                <tbody>
                  {supportContacts.map((contact) => (
                    <tr key={contact.id}>
                      <td>{contact.contact_name}</td>
                      <td>{contact.contact_type}</td>
                      <td>{contact.contact_value}</td>
                      <td>{contact.purpose}</td>
                    </tr>
                  ))}
                  {supportContacts.length === 0 && <tr><td colSpan={4} className="muted text-center">No support contacts available.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
      </main>
    </div>
  );
}