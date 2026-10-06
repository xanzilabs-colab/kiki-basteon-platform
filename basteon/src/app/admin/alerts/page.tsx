"use client";

import { Download, FileDown, ListChecks, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/client";
import { AlertTypeBadge } from "@/components/alerts/AlertTypeBadge";
import { useEmergencyTypes } from "@/hooks/useEmergencyTypes";

export default function AlertsPage() {
  const { alerts } = useRealtimeAlerts();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const emergencyTypes = useEmergencyTypes();
  const rows = useMemo(
    () => alerts.filter((a) => (statusFilter === "all" || a.status === statusFilter) && (typeFilter === "all" || (a.type_code ?? "sos") === typeFilter)),
    [alerts, statusFilter, typeFilter],
  );

  function download(name: string, csv: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const csv = [
      "id,device,status,type_code,type_source,type_updated_at,lat,lng,loc_source,triggered_at",
      ...rows.map((a) =>
        [a.id, a.device_id, a.status, a.type_code ?? "sos", a.type_source ?? "legacy", a.type_updated_at ?? "", a.lat, a.lng, a.loc_source, a.triggered_at].join(","),
      ),
    ].join("\n");
    download("basteon-alerts.csv", csv);
  }

  async function exportTrail(alertId: string) {
    const { data } = await createClient()
      .from("alert_locations")
      .select("ctr,lat,lng,loc_source,fix_age_s,battery,recorded_at")
      .eq("alert_id", alertId)
      .order("recorded_at");
    const csv = [
      "ctr,lat,lng,loc_source,fix_age_s,battery,recorded_at",
      ...(data ?? []).map((point) =>
        [
          point.ctr,
          point.lat,
          point.lng,
          point.loc_source,
          point.fix_age_s,
          point.battery,
          point.recorded_at,
        ].join(","),
      ),
    ].join("\n");
    download(`basteon-trail-${alertId}.csv`, csv);
  }

  return (
    <div className="max-w-[1280px] space-y-6">
      <header className="flex flex-col gap-4 border-b border-[#282930] pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
            <ListChecks size={20} className="text-slate-400" />
            System Alert &amp; GPS Audit Log
          </h1>
          <p className="mt-1 text-xs text-slate-400">Immutable high-density incident event trails and telemetry logs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded border border-[#282930] bg-[#0B0C0E] px-3 text-xs text-slate-200 outline-none focus:border-[#3B82F6]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {["new", "acknowledged", "enroute", "on_scene", "resolved", "false_alarm"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Filter by emergency type" className="h-9 rounded border border-[#282930] bg-[#0B0C0E] px-3 text-xs text-slate-200 outline-none focus:border-[#087f70]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All alert types</option>
            {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
          </select>
          <button className="inline-flex h-9 items-center gap-2 rounded bg-[#3B82F6] px-3.5 text-xs font-medium text-white transition-colors hover:bg-[#2563EB]" onClick={exportCsv}>
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      </header>

      <section className="overflow-x-auto rounded border border-[#282930] bg-[#16171B]">
        <table className="w-full min-w-[900px] border-collapse text-left text-xs">
          <thead className="border-b border-[#282930] bg-[#111215] font-mono text-slate-400">
            <tr>
              <th className="p-3 font-medium">TIMESTAMP</th>
              <th className="p-3 font-medium">DEVICE ID</th>
              <th className="p-3 font-medium">STATUS</th>
              <th className="p-3 font-medium">TYPE</th>
              <th className="p-3 font-medium">LATITUDE</th>
              <th className="p-3 font-medium">LONGITUDE</th>
              <th className="p-3 font-medium">SOURCE</th>
              <th className="p-3 text-right font-medium">ACTION</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#282930]">
            {rows.map((a) => (
              <tr key={a.id} className="transition-colors hover:bg-[#1C1D22]">
                <td className="p-3 font-mono text-slate-300">{new Date(a.triggered_at).toLocaleString("en-ZA")}</td>
                <td className="p-3 font-mono font-bold text-white">{a.device_id}</td>
                <td className="p-3"><StatusBadge status={a.status} /></td>
                <td className="p-3"><AlertTypeBadge typeCode={a.type_code} /></td>
                <td className="p-3 font-mono text-slate-300">{a.lat?.toFixed(6) ?? "—"}</td>
                <td className="p-3 font-mono text-slate-300">{a.lng?.toFixed(6) ?? "—"}</td>
                <td className="p-3 font-mono text-[11px] text-slate-400 uppercase">{a.loc_source ?? "no fix"}</td>
                <td className="p-3 text-right">
                  <button className="inline-flex items-center gap-1.5 rounded border border-[#31333C] bg-[#1C1D22] px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-[#23252C]" onClick={() => void exportTrail(a.id)}>
                    <Download size={13} className="text-slate-400" />
                    Trail CSV
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-slate-500"><MapPin className="mx-auto mb-2" size={20} />No alerts match this filter.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}