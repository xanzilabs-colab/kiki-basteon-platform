import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BuddyAuditEvent =
  | "trip_created" | "bubble_created" | "member_joined" | "quick_update"
  | "meeting_confirmed" | "virtual_walk_started" | "virtual_walk_answered"
  | "virtual_walk_ended" | "safety_reported" | "buddy_blocked" | "bubble_closed";

type AuditInput = {
  bubbleId?: string;
  tripId?: string;
  actorId?: string;
  actorAlias?: string | null;
  event: BuddyAuditEvent;
  details?: Record<string, string | boolean | number | null>;
};

export async function recordBuddyAudit(db: SupabaseClient, input: AuditInput) {
  const { error } = await db.from("buddy_audit_events").insert({
    bubble_id: input.bubbleId ?? null,
    trip_id: input.tripId ?? null,
    actor_id: input.actorId ?? null,
    actor_alias: input.actorAlias ?? null,
    event: input.event,
    details: input.details ?? {},
  });
  if (error) console.error("Buddy audit write failed", error);
}