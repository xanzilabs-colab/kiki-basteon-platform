"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Alert } from "@/lib/types";

function elapsed(from: string, now: number) {
  const s = Math.max(0, Math.floor((now - +new Date(from)) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function AlertBanner({
  count,
  oldest,
  onJump,
}: {
  count: number;
  oldest: Alert | null;
  onJump(a: Alert): void;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!count || !oldest) return null;

  return (
    <button
      onClick={() => onJump(oldest)}
      className="alert-banner absolute z-[1050] top-3 left-1/2 -translate-x-1/2
                 max-w-[calc(100%-24px)] flex items-center gap-3 h-9 pl-3 pr-4"
    >
      <TriangleAlert size={15} className="pulse shrink-0" />
      <span className="text-[12px] font-bold whitespace-nowrap">
        {count} unacknowledged
      </span>
      <span className="w-px h-4 bg-[var(--st-new-ink)]" />
      <span className="text-[12px] truncate">
        {oldest.device?.device_name ?? oldest.device_id}
      </span>
      <span className="data text-[12px] font-bold whitespace-nowrap">
        {now ? elapsed(oldest.triggered_at, now) : "--"}
      </span>
    </button>
  );
}