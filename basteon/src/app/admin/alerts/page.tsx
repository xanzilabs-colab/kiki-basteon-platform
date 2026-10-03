"use client";

import { useMemo, useState } from "react";
import { useRealtimeAlerts } from "@/hooks/useRealtimeAlerts";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/client";

export default function AlertsPage() {
  const { alerts } = useRealtimeAlerts();
  const [filter, setFilter] = useState("all");
  const rows = useMemo(
    () => alerts.filter((a) => filter === "all" || a.status === filter),
    [alerts, filter],
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
      "id,device,status,lat,lng,loc_source,triggered_at",
      ...rows.map((a) =>
        [a.id, a.device_id, a.status, a.lat, a.lng, a.loc_source, a.triggered_at].join(","),
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
    <div className="space-y-5 max-w-[1280px]">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="eyebrow">Audit</p>
          <h1 className="page-title mt-1">Alert log</h1>
        </div>
        <div className="flex gap-2">
          <select
            className="input"
            style={{ width: 180 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {["new", "acknowledged", "enroute", "on_scene", "resolved", "false_alarm"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[900px]">
          <thead>
            <tr>
              <th>Time</th>
              <th>Device</th>
              <th>Status</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="data">{new Date(a.triggered_at).toLocaleString()}</td>
                <td className="data">{a.device_id}</td>
                <td><StatusBadge status={a.status} /></td>
                <td className="data">{a.lat?.toFixed(6) ?? "—"}</td>
                <td className="data">{a.lng?.toFixed(6) ?? "—"}</td>
                <td className="muted uppercase text-[10.5px] tracking-[.04em]">
                  {a.loc_source ?? "no fix"}
                </td>
                <td>
                  <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => void exportTrail(a.id)}>
                    Trail CSV
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}