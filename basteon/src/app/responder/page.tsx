"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
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

const AlertMap = dynamic(() => import("@/components/AlertMap"), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center label">Initialising map…</div>,
});

export default function ResponderPage() {
  const { alerts, events, connection, error: alertError, refresh } = useRealtimeAlerts();
  const { position, error } = useGeolocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "all">("active");
  const [profile, setProfile] = useState<ProfileContact | null>(null);

  const active = useMemo(() => alerts.filter((a) => activeStatuses.includes(a.status)), [alerts]);
  const unacked = useMemo(
    () => active.filter((a) => a.status === "new").sort((a, b) => +new Date(a.triggered_at) - +new Date(b.triggered_at)),
    [active],
  );
  const selected = alerts.find((a) => a.id === selectedId) ?? unacked[0] ?? active[0] ?? null;
  const trail = useAlertTrail(selected?.id ?? null);
  const displayed = useMemo(
    () => [...(tab === "active" ? active : alerts)].sort((a, b) =>
      a.status === "new" && b.status !== "new" ? -1 :
      b.status === "new" && a.status !== "new" ? 1 :
      +new Date(b.triggered_at) - +new Date(a.triggered_at)),
    [alerts, active, tab],
  );

  return (
    <div className="h-screen grid grid-rows-[auto_1fr] overflow-hidden">
      <Navbar>
        <ConnectionIndicator state={connection} />
        <SoundToggle />
      </Navbar>

      <main className="relative min-h-0 min-w-0">
        {alertError && <div role="alert" className="absolute z-[1100] top-3 left-3 right-3 md:left-[352px] lg:right-[372px] border border-[#6b2b32] bg-[rgb(255_77_90/.92)] p-3 text-sm text-white">Unable to load alerts: {alertError}</div>}
        <div className="absolute inset-0">
          <AlertMap alerts={active} selected={selected} me={position} trail={trail} onSelect={(a) => setSelectedId(a.id)} />
        </div>

        <AlertBanner count={unacked.length} oldest={unacked[0] ?? null} onJump={(a: Alert) => setSelectedId(a.id)} />

        {/* Incident queue */}
        <aside className="hidden md:flex absolute z-[1000] top-3 bottom-3 left-3 w-[340px] flex-col glass overflow-hidden">
          <div className="pane-head">
            <span>Incident queue</span>
            <span className="data normal-case tracking-normal">{active.length} active</span>
          </div>
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>Active ({active.length})</button>
            <button className="tab" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>All ({alerts.length})</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AlertList alerts={displayed} selected={selected?.id ?? null} me={position} onSelect={(a: Alert) => setSelectedId(a.id)} />
          </div>
          {error && <div className="px-3 py-2 border-t border-[var(--line)] text-[11px] text-[var(--warn)] data">GPS: {error}</div>}
        </aside>

        {/* Incident detail: right card on desktop, bottom sheet on small screens */}
        <aside className="absolute z-[1000] glass overflow-y-auto bottom-0 left-0 right-0 max-h-[52%] rounded-b-none lg:rounded-b-[4px] lg:top-3 lg:bottom-3 lg:left-auto lg:right-3 lg:w-[360px] lg:max-h-none">
          <AlertDetailPanel alert={selected} events={events} refresh={refresh} onViewProfile={(alert) => setProfile(alert.device?.owner ?? null)} />
        </aside>
        <UserProfileDrawer profile={profile} onClose={() => setProfile(null)} />
      </main>
    </div>
  );
}