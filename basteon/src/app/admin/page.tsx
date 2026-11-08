"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, Clock3, Smartphone, Users } from "lucide-react";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { activeStatuses } from "@/lib/status";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertTypeBadge } from "@/components/alerts/AlertTypeBadge";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";

function initials(name: string | null | undefined) {
  return (name ?? "Kiki").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

const stages = [
  { key: "new", label: "New", color: "var(--crit)" },
  { key: "acknowledged", label: "Acknowledged", color: "var(--warn)" },
  { key: "enroute", label: "En route", color: "var(--info)" },
  { key: "on_scene", label: "On scene", color: "var(--violet)" },
  { key: "resolved", label: "Resolved", color: "var(--ok)" },
  { key: "false_alarm", label: "False alarm", color: "var(--muted)" },
];

export default function AdminPage() {
  const { alerts } = useRealtimeAlerts();
  const emergencyTypes = useEmergencyTypes();
  const active = alerts.filter((alert) => activeStatuses.includes(alert.status));
  const unacknowledged = active.filter((alert) => alert.status === "new").length;
  const today = alerts.filter((alert) => new Date(alert.triggered_at).toDateString() === new Date().toDateString());
  const falseToday = today.filter((alert) => alert.status === "false_alarm").length;
  const falseRate = today.length ? Math.round((falseToday / today.length) * 100) : 0;
  const resolvedToday = today.filter((alert) => alert.status === "resolved").length;
  const latest = [...alerts].sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()).slice(0, 6);
  const maxCount = Math.max(alerts.length, 1);

  const metrics = [
    { label: "Live alerts", value: active.length, note: unacknowledged ? `${unacknowledged} need acknowledgement` : "All active alerts acknowledged", critical: unacknowledged > 0 },
    { label: "Alerts today", value: today.length, note: `${alerts.length} recorded overall` },
    { label: "Resolved today", value: resolvedToday, note: `${resolvedToday} completed responses` },
    { label: "False alarm rate", value: `${falseRate}%`, note: `${falseToday} of ${today.length || 0} today` },
  ];

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <h1>Overview</h1>
          <p>Monitor incoming Kiki alerts, response progress and platform activity from one place.</p>
        </div>
        <Link className="btn" href="/admin/devices"><Smartphone size={16} />Manage devices</Link>
      </header>

      <section className="admin-panel admin-kpi-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className={metric.critical ? "is-critical" : ""}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <div className="admin-dashboard-grid">
        <section className="panel">
          <div className="pane-head"><div><span>Response queue</span><p>Most recent alerts across the platform</p></div><Link className="btn admin-small-button" href="/admin/alerts">View all</Link></div>
          {latest.length === 0 ? <div className="admin-empty"><Activity size={24} /><strong>No alerts recorded</strong><span>New emergency activity will appear here.</span></div> : <div>{latest.map((alert) => <Link key={alert.id} href="/admin/alerts" className="admin-queue-row"><span className="admin-avatar">{initials(alert.device?.owner?.full_name)}</span><span className="admin-queue-copy"><b>{alert.device?.device_name ?? `Device ${alert.device_id}`}</b><small>{alert.device?.owner?.full_name ? `${alert.device.owner.full_name} · ` : ""}{new Date(alert.triggered_at).toLocaleString()}</small></span><span className="admin-queue-status"><AlertTypeBadge typeCode={alert.type_code} variant="admin" /><StatusBadge status={alert.status} /></span><ArrowUpRight className="admin-queue-arrow" size={16} /></Link>)}</div>}
        </section>

        <aside className="admin-dashboard-aside">
          <section className="panel">
            <div className="pane-head"><span>Alert status</span><span className="data">{alerts.length} total</span></div>
            <div className="admin-alert-bars">{stages.map((stage) => {
              const count = alerts.filter((alert) => alert.status === stage.key).length;
              return <div key={stage.key}><span>{stage.label}</span><i><span style={{ width: `${(count / maxCount) * 100}%`, background: stage.color }} /></i><b className="data">{count}</b></div>;
            })}</div>
          </section>

          <section className="panel">
            <div className="pane-head"><span>Emergency types</span></div>
            <div className="admin-emergency-types">{emergencyTypes.map((type) => <div key={type.code}><AlertTypeBadge typeCode={type.code} variant="admin" /><b className="data">{alerts.filter((alert) => ((alert.type_code === "sos" ? "general" : alert.type_code) ?? "general") === type.code).length}</b></div>)}</div>
          </section>

          <section className="panel admin-readiness">
            <div className="admin-readiness-heading"><span><Clock3 size={18} /></span><div><b>Response readiness</b><small>Real-time alert monitoring is active.</small></div></div>
            <div className="admin-readiness-links"><Link href="/admin/users"><Users size={16} />Users</Link><Link href="/admin/devices"><Smartphone size={16} />Devices</Link></div>
          </section>
        </aside>
      </div>
    </div>
  );
}