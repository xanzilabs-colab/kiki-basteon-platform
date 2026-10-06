"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, ShieldCheck, Smartphone, Users } from "lucide-react";
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
    { label: "Live alerts", value: active.length, note: unacknowledged ? `${unacknowledged} need acknowledgement` : "All active alerts acknowledged", icon: AlertTriangle, critical: unacknowledged > 0 },
    { label: "Alerts today", value: today.length, note: `${alerts.length} recorded overall`, icon: Activity },
    { label: "Resolved today", value: resolvedToday, note: `${resolvedToday} completed responses`, icon: CheckCircle2 },
    { label: "False alarm rate", value: `${falseRate}%`, note: `${falseToday} of ${today.length || 0} today`, icon: ShieldCheck },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Operations command</p>
          <h1 className="page-title mt-1">Overview</h1>
          <p className="muted mt-2 max-w-xl text-[13px]">Monitor incoming Kiki alerts, response progress, and platform activity from one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href="/admin/devices"><Smartphone size={16} />Manage devices</Link>
          <Link className="btn btn-primary" href="/responder">Open response console<ArrowUpRight size={16} /></Link>
        </div>
      </header>

      <section className="grid gap-px overflow-hidden border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="min-h-[154px] bg-[var(--surface-1)] p-5">
            <div className="flex items-start justify-between gap-4">
              <span className="muted text-[12px] font-semibold">{metric.label}</span>
              <metric.icon size={18} className={metric.critical ? "text-[var(--crit)]" : "text-[var(--muted)]"} aria-hidden="true" />
            </div>
            <strong className={metric.critical ? "mt-5 block font-[var(--font-display)] text-4xl text-[var(--crit)]" : "mt-5 block font-[var(--font-display)] text-4xl"}>{metric.value}</strong>
            <span className="muted mt-2 block text-[12px]">{metric.note}</span>
          </article>
        ))}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel">
          <div className="pane-head"><div><span>Response queue</span><p className="muted mt-0.5 font-[var(--font-ui)] text-[11px] font-normal">Most recent alerts across the platform</p></div><Link className="btn" style={{ height: 30 }} href="/admin/alerts">View all</Link></div>
          {latest.length === 0 ? <div className="p-8 text-center"><Activity className="mx-auto text-[var(--muted)]" size={24} /><p className="mt-3 font-medium">No alerts recorded</p><p className="muted mt-1 text-[12px]">New emergency activity will appear here.</p></div> : <div className="divide-y divide-[var(--line)]">{latest.map((alert) => <Link key={alert.id} href="/responder" className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-2)]"><span className="grid h-9 w-9 overflow-hidden place-items-center rounded-full bg-[var(--surface-2)] text-[11px] font-bold text-[var(--text)]">{alert.device?.owner?.avatar_url ? <img src={alert.device.owner.avatar_url} alt={`${alert.device.owner.full_name ?? "Device owner"} profile`} className="h-full w-full object-cover" /> : initials(alert.device?.owner?.full_name)}</span><span className="min-w-0"><b className="block truncate text-[13px]">{alert.device?.device_name ?? `Device ${alert.device_id}`}</b><span className="muted mt-1 block truncate text-[11px]">{alert.device?.owner?.full_name ? `${alert.device.owner.full_name} · ` : ""}{new Date(alert.triggered_at).toLocaleString()}</span></span><span className="flex flex-col items-end gap-2"><AlertTypeBadge typeCode={alert.type_code} /><StatusBadge status={alert.status} /><ArrowUpRight className="text-[var(--muted)] group-hover:text-[var(--text)]" size={15} /></span></Link>)}</div>}
        </section>

        <aside className="space-y-5">
          <section className="panel">
            <div className="pane-head"><span>Alert status</span><span className="data text-[12px]">{alerts.length} total</span></div>
            <div className="p-5 space-y-4">{stages.map((stage) => {
              const count = alerts.filter((alert) => alert.status === stage.key).length;
              return <div key={stage.key} className="grid grid-cols-[98px_minmax(0,1fr)_auto] items-center gap-3"><span className="muted text-[11px] font-medium">{stage.label}</span><span className="h-1.5 overflow-hidden bg-[var(--surface-2)]"><span className="block h-full" style={{ width: `${(count / maxCount) * 100}%`, background: stage.color }} /></span><b className="data text-[12px]">{count}</b></div>;
            })}</div>
          </section>

          <section className="panel">
            <div className="pane-head"><span>Emergency types</span></div>
            <div className="space-y-3 p-5">{emergencyTypes.map((type) => <div key={type.code} className="flex items-center justify-between gap-3"><AlertTypeBadge typeCode={type.code} /><b className="data text-[13px]">{alerts.filter((alert) => (alert.type_code ?? "sos") === type.code).length}</b></div>)}</div>
          </section>

          <section className="panel p-5">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center bg-[var(--surface-2)] text-[var(--text)]"><Clock3 size={18} /></span><div><p className="text-[13px] font-semibold">Response readiness</p><p className="muted text-[11px]">Real-time alert monitoring is active.</p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-px bg-[var(--line)]"><Link href="/admin/users" className="flex items-center gap-2 bg-[var(--surface-1)] p-3 text-[12px] font-semibold hover:bg-[var(--surface-2)]"><Users size={16} />Users</Link><Link href="/admin/devices" className="flex items-center gap-2 bg-[var(--surface-1)] p-3 text-[12px] font-semibold hover:bg-[var(--surface-2)]"><Smartphone size={16} />Devices</Link></div>
          </section>
        </aside>
      </div>
    </div>
  );
}