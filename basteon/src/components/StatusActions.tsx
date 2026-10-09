"use client";

import { useState } from "react";
import { toast } from "sonner";
import { transitions, statusLabels } from "@/lib/status";
import type { Alert, AlertStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

export function StatusActions({
  alert,
  admin,
  closeOnly,
  onChanged,
}: {
  alert: Alert;
  admin?: boolean;
  closeOnly?: boolean;
  onChanged(): void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const closableStatuses = new Set<AlertStatus>(["new", "acknowledged", "enroute", "on_scene"]);
  const reopenChoice: AlertStatus[] = admin && (alert.status === "resolved" || alert.status === "false_alarm") ? ["acknowledged"] : [];
  const choices: AlertStatus[] = closeOnly
    ? (closableStatuses.has(alert.status) ? ["resolved"] : [])
    : [...transitions[alert.status], ...reopenChoice];

  async function change(status: AlertStatus) {
    setBusy(true);
    try {
      if (closeOnly) {
        const response = await fetch("/api/alerts/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId: alert.id, note: note.trim() || undefined }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Could not close this incident.");
      } else {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Your session has expired. Sign in and try again.");
        const { error } = await supabase.from("alerts").update({ status }).eq("id", alert.id);
        if (error) throw error;
        if (note.trim()) {
          const { error: eventError } = await supabase.from("alert_events").insert({
            alert_id: alert.id,
            actor_id: user.id,
            from_status: alert.status,
            to_status: status,
            note: note.trim(),
          });
          if (eventError) throw eventError;
        }
      }
      setNote("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update alert status.");
    } finally {
      setBusy(false);
    }
  }

  if (closeOnly && choices.length === 0) return <p className="muted text-[11px]">Incident is closed.</p>;
  return (
    <div className="space-y-2">
      <input className="input text-sm" placeholder="Optional operational note" value={note} onChange={(event) => setNote(event.target.value)} />
      {choices.map((status) => (
        <button disabled={busy} className="btn w-full text-sm" key={status} onClick={() => void change(status)}>
          {status === "acknowledged" && (alert.status === "resolved" || alert.status === "false_alarm") ? "Reopen" : closeOnly ? "Resolve incident" : statusLabels[status]}
        </button>
      ))}
    </div>
  );
}
