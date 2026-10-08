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

const AlertMap = dynamic(() => import("@/components/AlertMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center">
      <span className="label">Initialising map…</span>
    </div>
  ),
});

export default function ResponderPage() {
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts();
  const { position, error } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "all">("active");
  const [profile, setProfile] = useState<ProfileContact | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
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
        setOrganisationName(body?.organisation?.name ?? "");
      }
    })();
  }, []);

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
      [...(tab === "active" ? active : alerts)].filter((alert) => typeFilter === "all" || (alert.type_code ?? "sos") === typeFilter).sort((a, b) =>
        a.status === "new" && b.status !== "new" ? -1
        : b.status === "new" && a.status !== "new" ? 1
        : +new Date(b.triggered_at) - +new Date(a.triggered_at),
      ),
    [alerts, active, tab, typeFilter],
  );

  return (
    <div className="h-screen grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg)]">
      <Navbar>
        <ConnectionIndicator state={connection} />
        <SoundToggle />
      </Navbar>

      <main className="relative min-h-0 min-w-0">
        <div className="absolute z-[1100] left-3 right-3 top-3 md:left-[calc(var(--rail-l)+12px)] md:right-[calc(var(--rail-r)+12px)]">
          <div className="panel px-3 py-2 text-[12px] flex flex-wrap items-center gap-2">
            <span className="status status-blue">Responder Console</span>
            {organisationName && <span className="muted">Organisation: {organisationName}</span>}
            {operatorName && <span className="muted">Operator: {operatorName}</span>}
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

        <AlertBanner
          count={unacked.length}
          oldest={unacked[0] ?? null}
          onJump={(a: Alert) => setSelectedId(a.id)}
        />

        {/* ── Left rail: Incident queue ─────────────────────────── */}
        <aside
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

          <div className="px-3 pb-2"><label className="sr-only" htmlFor="responder-type-filter">Filter by alert type</label><select id="responder-type-filter" className="input h-8 text-[12px]" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All alert types</option>{emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}</select></div>

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
        </aside>

        {/* ── Right rail: Incident detail ──────────────────────── */}
        <aside
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
            onViewProfile={(alert) => setProfile(alert.device?.owner ?? null)}
          />
        </aside>

        <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
      </main>
    </div>
  );
}