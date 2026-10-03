import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alerts")
    .select(
      "*, device:devices(device_name,user_id,owner:profiles(full_name,phone)), assignee:profiles!alerts_assigned_to_fkey(full_name)",
    )
    .in("status", ["resolved", "false_alarm"])
    .order("triggered_at", { ascending: false })
    .range(0, 49);

  return (
    <main className="p-6 max-w-[1280px]">
      <p className="eyebrow">Audit</p>
      <h1 className="page-title mt-1 mb-5">Response history</h1>

      <div className="overflow-x-auto">
        <div className="tbl-wrap min-w-max">
        <table className="tbl min-w-[640px]">
          <thead>
            <tr>
              <th>Time</th>
              <th>Device</th>
              <th>Status</th>
              <th>Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((alert: any) => (
              <tr key={alert.id}>
                <td className="data">{new Date(alert.triggered_at).toLocaleString()}</td>
                <td>{alert.device?.device_name ?? alert.device_id}</td>
                <td><StatusBadge status={alert.status} /></td>
                <td className="muted">{alert.assignee?.full_name ?? "—"}</td>
              </tr>
            ))}
            {(data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="muted text-center" style={{ height: 64 }}>
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