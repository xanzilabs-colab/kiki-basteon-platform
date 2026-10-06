import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertTypeBadge } from "@/components/alerts/AlertTypeBadge";
import { BUILT_IN_EMERGENCY_TYPES } from "@/lib/sos/emergencyTypes";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const supabase = await createClient();
  const params = await searchParams;
  const { data: catalogue } = await supabase.from("emergency_types").select("code,label,short_label,icon,tone,life_threat,sort_order,active").eq("active", true).order("sort_order");
  const typeOptions = catalogue?.length ? catalogue : BUILT_IN_EMERGENCY_TYPES;
  const chosenType = typeOptions.some((type) => type.code === params.type) ? params.type : "all";
  let query = supabase.from("alerts").select("*, device:devices(device_name,user_id,owner:profiles(full_name,phone)), assignee:profiles!alerts_assigned_to_fkey(full_name)").in("status", ["resolved", "false_alarm"]);
  if (chosenType !== "all") query = query.eq("type_code", chosenType);
  const { data } = await query.order("triggered_at", { ascending: false }).range(0, 49);

  return (
    <main className="p-6 max-w-[1280px]">
      <p className="eyebrow">Audit</p>
      <h1 className="page-title mt-1 mb-5">Response history</h1>

      <form className="mb-4 flex items-center gap-2" method="get">
        <label className="label" htmlFor="history-type">Emergency type</label>
        <select id="history-type" name="type" className="input max-w-[220px]" defaultValue={chosenType}>
          <option value="all">All types</option>
          {typeOptions.map((type) => <option key={type.code} value={type.code}>{type.short_label}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
      </form>

      <div className="overflow-x-auto">
        <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[640px]">
          <thead>
            <tr>
              <th>Time</th>
              <th>Device</th>
              <th>Status</th>
              <th>Type</th>
              <th>Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((alert: any) => (
              <tr key={alert.id}>
                <td className="data">{new Date(alert.triggered_at).toLocaleString()}</td>
                <td>{alert.device?.device_name ?? alert.device_id}</td>
                <td><StatusBadge status={alert.status} /></td>
                <td><AlertTypeBadge typeCode={alert.type_code} /></td>
                <td className="muted">{alert.assignee?.full_name ?? "—"}</td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="muted text-center" style={{ height: 64 }}>
                  No incidents in history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </main>
  );
}