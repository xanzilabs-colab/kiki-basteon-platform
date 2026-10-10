import { distanceToPolylineM } from "./geometry";
type GeoPoint = { lat: number; lng: number };

export type CheckpointStatus = "pending" | "prompted" | "checked_in" | "missed" | "escalated" | "skipped";
export type Checkpoint = { id: string; expectedAt: number; status: CheckpointStatus; remindersSent: number; lastNotifiedAt?: number | null };
export type CheckpointConfig = { promptLeadMs: number; graceMs: number; reminderIntervalMs: number; maxReminders: number };
export type CheckpointAction = "none" | "prompt" | "reminder" | "escalate";

export const checkpointConfig = (env: Record<string, string | undefined> = process.env): CheckpointConfig => {
  const min = (value: string | undefined, fallback: number, lo: number, hi: number) => {
    const n = Number(value);
    return (Number.isFinite(n) && n >= lo && n <= hi ? n : fallback) * 60_000;
  };
  return {
    promptLeadMs: min(env.CHECKPOINT_PROMPT_LEAD_MIN, 5, 0, 60),
    graceMs: min(env.CHECKPOINT_GRACE_MIN, 10, 1, 120),
    reminderIntervalMs: min(env.CHECKPOINT_REMINDER_INTERVAL_MIN, 5, 1, 60),
    maxReminders: Math.min(5, Math.max(1, Number(env.CHECKPOINT_MAX_REMINDERS) || 2)),
  };
};

/**
 * Decides the next step for a planned stop. Escalation is only ever to the trip's guardians/organisation
 * monitoring; it never creates an SOS, which remains a separate, user-initiated flow.
 */
export function evaluateCheckpoint(cp: Checkpoint, now: number, cfg: CheckpointConfig): CheckpointAction {
  if (["checked_in", "skipped", "escalated"].includes(cp.status)) return "none";
  const due = cp.expectedAt;
  if (now < due - cfg.promptLeadMs) return "none";
  if (now < due) return cp.status === "pending" ? "prompt" : "none";
  if (now < due + cfg.graceMs) return cp.status === "pending" || cp.status === "prompted" ? "prompt" : "none";
  if (cp.remindersSent >= cfg.maxReminders) return "escalate";
  const last = cp.lastNotifiedAt ?? 0;
  return now - last >= cfg.reminderIntervalMs ? "reminder" : "none";
}

export type DeviationConfig = { offRouteM: number; consecutiveFixes: number; overdueGraceMs: number };
export const deviationConfig = (env: Record<string, string | undefined> = process.env): DeviationConfig => ({
  offRouteM: Math.min(2000, Math.max(50, Number(env.ROUTE_DEVIATION_M) || 200)),
  consecutiveFixes: Math.min(10, Math.max(2, Number(env.ROUTE_DEVIATION_FIXES) || 3)),
  overdueGraceMs: Math.min(120, Math.max(1, Number(env.TRIP_OVERDUE_GRACE_MIN) || 10)) * 60_000,
});

export type Fix = GeoPoint & { accuracyM?: number };

/** Off-route only after several consecutive fixes beyond the threshold (widened by GPS accuracy) so noise doesn't trigger it. */
export function isOffRoute(recent: Fix[], route: GeoPoint[], cfg: DeviationConfig) {
  if (route.length < 2 || recent.length < cfg.consecutiveFixes) return false;
  return recent.slice(-cfg.consecutiveFixes).every((fix) => distanceToPolylineM(fix, route) > Math.max(cfg.offRouteM, (fix.accuracyM ?? 0) * 2));
}

export const isOverdue = (expectedArrivalAt: number, now: number, cfg: DeviationConfig) => now > expectedArrivalAt + cfg.overdueGraceMs;
