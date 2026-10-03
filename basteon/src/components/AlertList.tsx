"use client";

import type { Alert } from "@/lib/types";
import type { Position } from "@/lib/geo";
import { AlertCard } from "./AlertCard";

export function AlertList({
  alerts,
  selected,
  onSelect,
  me,
}: {
  alerts: Alert[];
  selected: string | null;
  onSelect(alert: Alert): void;
  me: Position | null;
}) {
  if (!alerts.length) {
    return (
      <div className="p-8 text-center">
        <p className="label">No incidents</p>
        <p className="muted text-[12px] mt-1">All clear.</p>
      </div>
    );
  }
  return (
    <div>
      {alerts.map((a) => (
        <AlertCard
          key={a.id}
          alert={a}
          me={me}
          selected={selected === a.id}
          onSelect={() => onSelect(a)}
        />
      ))}
    </div>
  );
}