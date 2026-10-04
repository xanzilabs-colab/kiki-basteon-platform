import "server-only";
import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../../_shared";

export async function requireBubbleMember(bubbleId: string) {
  const access = await requireBuddyUser();
  if ("error" in access) return access;
  const { data: member, error } = await access.db.from("buddy_bubble_members").select("bubble_id,trip_id").eq("bubble_id", bubbleId).eq("user_id", access.user.id).is("left_at", null).maybeSingle();
  if (error) {
    console.error("Buddy bubble membership read failed", error);
    return { error: safeJson({ error: "bubble_unavailable" }, { status: 500 }) } as const;
  }
  if (!member) return { error: safeJson({ error: "bubble_not_found" }, { status: 404 }) } as const;
  const { data: trip, error: tripError } = member.trip_id
    ? await access.db.from("buddy_trips").select("alias").eq("id", member.trip_id).maybeSingle()
    : { data: null, error: null };
  if (tripError) console.warn("Buddy bubble alias read failed", tripError);
  const alias = trip?.alias ?? null;
  return { ...access, alias };
}