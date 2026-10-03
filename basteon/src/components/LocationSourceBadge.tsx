import type { Alert } from "@/lib/types";

export function LocationSourceBadge({ alert }: { alert: Pick<Alert, "loc_source" | "fix_age_s"> }) {
  if (!alert.loc_source) return <span className="status status-red w-fit">No GPS fix</span>;
  const text =
    alert.loc_source === "gps" ? `Live GPS${alert.fix_age_s != null ? ` · ${alert.fix_age_s}s` : ""}` :
    alert.loc_source === "stale" ? `Last fix · ${Math.max(1, Math.round((alert.fix_age_s ?? 0) / 60))} min old` :
    alert.loc_source === "cached" ? "Last known position" : "Test location";
  const tone = alert.loc_source === "gps" ? "status-green" : alert.loc_source === "dev" ? "status-gray" : "status-amber";
  return <span className={`status ${tone} w-fit`}>{text}</span>;
}