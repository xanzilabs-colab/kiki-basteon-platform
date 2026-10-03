"use client";

import Link from "next/link";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { activeStatuses } from "@/lib/status";
import { AlertList } from "@/components/AlertList";
import { useGeolocation } from "@/hooks/useGeolocation";

const STAGES = [
  { key: "new", label: "New", color: "var(--crit)" },
  { key: "acknowledged", label: "Acknowledged", color: "var(--warn)" },
  { key: "enroute", label: "En route", color: "var(--info)" },
  { key: "on_scene", label: "On scene", color: "var(--violet)" },
  { key: "resolved", label: "Resolved", color: "var(--ok)" },
  { key: "false_alarm", label: "False alarm", color: "var(--muted)" },
];

export default function AdminPage() {
  const { alerts } = useRealtimeAlerts();
  const { position } = useGeolocation();

  const active = alerts.filter((a) => activeStatuses.includes(a.status));
  const unacked = active.filter((a) => a.status === "new").length;
  const today = alerts.filter(
    (a) => new Date(a.triggered_at).toDateString() === new Date().toDateString(),
  );
  const falseToday = today.filter((a) => a.status === "false_alarm").length;
  const falseRate = today.length ? Math.round((falseToday / today.length) * 100) : 0;
  const resolved = alerts.filter((a) => a.status === "resolved").length;
  const max = Math.max(alerts.length, 1);

  return (
    <div className="space-y-5 max-w-[1280px]">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="eyebrow">Command overview</p>
          <h1 className="page-title mt-1">Emergency operations</h1>
        </div>
        <Link className="btn btn-primary" href="/responder">Open response console</Link>
      </div>

      <div className="kpi-strip">
        <div className={`kpi ${unacked ? "is-crit" : ""}`}>
          <span className="kpi-label">Active alerts</span>
          <span className="kpi-value">{active.length}</span>
          <span className="kpi-note">{unacked} unacknowledged</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Alerts today</span>
          <span className="kpi-value">{today.length}</span>
          <span className="kpi-note">{alerts.length} all time</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">False alarm rate today</span>
          <span className="kpi-value">{falseRate}%</span>
          <span className="kpi-note">{falseToday} of {today.length} alerts</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Resolved</span>
          <span className="kpi-value">{resolved}</span>
          <span className="kpi-note">of {alerts.length} total alerts</span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <section className="panel">
          <div className="pane-head">
            <span>Latest alerts</span>
            <span className="data">{alerts.length} total</span>
          </div>
          <AlertList
            alerts={alerts.slice(0, 8)}
            selected={null}
            me={position}
            onSelect={() => {}}
          />
        </section>

        <section className="panel">
          <div className="pane-head"><span>Alerts by status</span></div>
          {STAGES.map((s) => {
            const n = alerts.filter((a) => a.status === s.key).length;
            return (
              <div key={s.key} className="bd-row">
                <span>{s.label}</span>
                <span className="bd-track">
                  <span
                    className="bd-fill block"
                    style={{ width: `${(n / max) * 100}%`, ["--c" as string]: s.color }}
                  />
                </span>
                <span className="bd-num">{n}</span>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}