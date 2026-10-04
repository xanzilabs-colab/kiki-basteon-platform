import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../_shared";

export async function GET() {
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const { data: memberships, error: membershipsError } = await access.db.from("buddy_bubble_members").select("bubble_id").eq("user_id", access.user.id);
  if (membershipsError) return safeJson({ error: "history_unavailable" }, { status: 500 });
  const bubbleIds = (memberships ?? []).map((member) => member.bubble_id as string);
  const select = "id,bubble_id,trip_id,actor_id,actor_alias,event,details,created_at";
  const { data: ownEvents, error: ownEventsError } = await access.db.from("buddy_audit_events").select(select).eq("actor_id", access.user.id).order("created_at", { ascending: false }).limit(150);
  if (ownEventsError) return safeJson({ error: "history_unavailable" }, { status: 500 });
  if (bubbleIds.length === 0) return safeJson({ events: ownEvents ?? [] });

  const { data: bubbleEvents, error: bubbleEventsError } = await access.db.from("buddy_audit_events").select(select).in("bubble_id", bubbleIds).order("created_at", { ascending: false }).limit(150);
  if (bubbleEventsError) return safeJson({ error: "history_unavailable" }, { status: 500 });
  const events = [...(ownEvents ?? []), ...(bubbleEvents ?? [])];
  const unique = Array.from(new Map(events.map((event) => [event.id, event])).values())
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 150);
  return safeJson({ events: unique });
}