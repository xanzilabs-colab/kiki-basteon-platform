"use client";
import Link from "next/link";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { activeStatuses } from "@/lib/status";
import { StatsCards } from "@/components/StatsCards";
import { AlertList } from "@/components/AlertList";
import { useGeolocation } from "@/hooks/useGeolocation";

export default function AdminPage() {
  const { alerts } = useRealtimeAlerts();
  const { position } = useGeolocation();
  const active = alerts.filter((a) => activeStatuses.includes(a.status));
  const today = alerts.filter((a) => new Date(a.triggered_at).toDateString() === new Date().toDateString());
  const falseRate = today.length ? Math.round((today.filter((a) => a.status === "false_alarm").length / today.length) * 100) : 0;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-end justify-between">
        <div><p className="eyebrow">Command overview</p><h1 className="page-title mt-1">Emergency operations</h1></div>
        <Link className="btn btn-primary inline-flex items-center" href="/responder">Open responder console</Link>
      </div>
      <StatsCards values={[
        { label: "Active alerts", value: active.length },
        { label: "Alerts today", value: today.length },
        { label: "False alarm rate", value: `${falseRate}%` },
        { label: "Total alerts", value: alerts.length },
      ]} />
      <section className="panel max-w-xl">
        <div className="pane-head">Live recent alerts</div>
        <AlertList alerts={alerts.slice(0, 8)} selected={null} me={position} onSelect={() => {}} />
      </section>
    </div>
  );
}