import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../_shared";

type BuddyHistoryEvent = {
  id: number;
  actor_alias: string | null;
  event: string;
  details: unknown;
  created_at: string;
};

function toHistoryEvent(event: BuddyHistoryEvent) {
  const details = event.details;
  const key = details && typeof details === "object" && "key" in details && typeof details.key === "string"
    ? details.key
    : null;
  return {
    id: event.id,
    actor_alias: event.actor_alias,
    event: event.event,
    details: key ? { key } : null,
    created_at: event.created_at,
  };
}

function reportReadFailure(operation: string, error: { code?: string; message: string }) {
  console.error(`Buddy history ${operation} failed`, { code: error.code, message: error.message });
  return safeJson({ error: "history_unavailable" }, { status: 500 });
}

export async function GET() {
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const { data: memberships, error: membershipsError } = await access.db.from("buddy_bubble_members").select("bubble_id").eq("user_id", access.user.id);
  if (membershipsError) return reportReadFailure("membership lookup", membershipsError);
  const bubbleIds = Array.from(new Set((memberships ?? []).map((member) => member.bubble_id).filter((id): id is string => Boolean(id))));
  const select = "id,bubble_id,trip_id,actor_id,actor_alias,event,details,created_at";
  const { data: ownEvents, error: ownEventsError } = await access.db.from("buddy_audit_events").select(select).eq("actor_id", access.user.id).order("created_at", { ascending: false }).limit(150);
  if (ownEventsError) return reportReadFailure("personal event lookup", ownEventsError);
  if (bubbleIds.length === 0) return safeJson({ events: (ownEvents ?? []).map(toHistoryEvent) });

  const { data: bubbleEvents, error: bubbleEventsError } = await access.db.from("buddy_audit_events").select(select).in("bubble_id", bubbleIds).order("created_at", { ascending: false }).limit(150);
  if (bubbleEventsError) return reportReadFailure("bubble event lookup", bubbleEventsError);
  const events = [...(ownEvents ?? []), ...(bubbleEvents ?? [])];
  const unique = Array.from(new Map(events.map((event) => [event.id, event])).values())
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 150);
  return safeJson({ events: unique.map(toHistoryEvent) });
}