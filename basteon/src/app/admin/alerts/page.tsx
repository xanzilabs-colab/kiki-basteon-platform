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
    () => alerts.filter((a) => (statusFilter === "all" || a.status === statusFilter) && (typeFilter === "all" || ((a.type_code === "sos" ? "general" : a.type_code) ?? "general") === typeFilter)),
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
        [a.id, a.device_id, a.status, (a.type_code === "sos" ? "general" : a.type_code) ?? "general", a.type_source ?? "legacy", a.type_updated_at ?? "", a.lat, a.lng, a.loc_source, a.triggered_at].join(","),
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
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <h1>
            <ListChecks size={20} />
            System Alert &amp; GPS Audit Log
          </h1>
          <p>Immutable incident event trails and telemetry logs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {["new", "acknowledged", "enroute", "on_scene", "resolved", "false_alarm"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Filter by emergency type" className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All alert types</option>
            {emergencyTypes.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
          </select>
          <button className="btn btn-primary inline-flex items-center gap-2 px-3.5" onClick={exportCsv}>
            <FileDown size={15} />
            Export CSV
          </button>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table min-w-[900px]">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Device ID</th>
              <th>Status</th>
              <th>Type</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Source</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="admin-data">{new Date(a.triggered_at).toLocaleString("en-ZA")}</td>
                <td className="admin-data">{a.device_id}</td>
                <td><StatusBadge status={a.status} /></td>
                <td><AlertTypeBadge typeCode={a.type_code} variant="admin" /></td>
                <td className="admin-data">{a.lat?.toFixed(6) ?? "—"}</td>
                <td className="admin-data">{a.lng?.toFixed(6) ?? "—"}</td>
                <td className="admin-data">{a.loc_source ?? "no fix"}</td>
                <td className="text-right">
                  <button className="btn inline-flex items-center gap-1.5 px-2.5" onClick={() => void exportTrail(a.id)}>
                    <Download size={13} />
                    Trail CSV
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-center admin-muted"><MapPin className="mx-auto mb-2" size={20} />No alerts match this filter.</td></tr>}
          </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}