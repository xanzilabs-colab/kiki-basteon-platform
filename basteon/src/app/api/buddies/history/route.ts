import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../_shared";

export async function GET() {
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const { data: memberships } = await access.db.from("buddy_bubble_members").select("bubble_id").eq("user_id", access.user.id);
  const bubbleIds = (memberships ?? []).map((member) => member.bubble_id as string);
  let query = access.db.from("buddy_audit_events").select("id,bubble_id,trip_id,actor_id,actor_alias,event,details,created_at").order("created_at", { ascending: false }).limit(150);
  query = bubbleIds.length
    ? query.or(`actor_id.eq.${access.user.id},bubble_id.in.(${bubbleIds.join(",")})`)
    : query.eq("actor_id", access.user.id);
  const { data, error } = await query;
  if (error) return safeJson({ error: "history_unavailable" }, { status: 500 });
  return safeJson({ events: data ?? [] });
}