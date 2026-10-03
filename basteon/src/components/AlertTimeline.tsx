import { format } from "date-fns";
import type { AlertEvent } from "@/lib/types";
import { statusLabels } from "@/lib/status";

export function AlertTimeline({ events }: { events: AlertEvent[] }) {
  if (!events.length) return <p className="muted text-xs">No events yet.</p>;
  return (
    <ol className="relative ml-1 border-l border-[var(--line-strong)]">
      {events.map((e) => (
        <li key={e.id} className="relative pl-4 pb-4 last:pb-0">
          <i className="absolute -left-[4px] top-1 w-[7px] h-[7px] bg-[var(--accent)]" />
          <p className="text-[12px]">{e.note || `Status → ${statusLabels[e.to_status]}`}</p>
          <p className="data text-[10px] muted mt-0.5">{e.actor?.full_name ?? "System"} · {format(new Date(e.created_at), "dd MMM HH:mm:ss")}</p>
        </li>
      ))}
    </ol>
  );
}