import "server-only";
import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../../_shared";

export async function requireBubbleMember(bubbleId: string) {
  const access = await requireBuddyUser();
  if ("error" in access) return access;
  const { data: member } = await access.db.from("buddy_bubble_members").select("bubble_id,trip:buddy_trips(alias)").eq("bubble_id", bubbleId).eq("user_id", access.user.id).is("left_at", null).maybeSingle();
  if (!member) return { error: safeJson({ error: "bubble_not_found" }, { status: 404 }) } as const;
  const alias = ((member as { trip?: { alias?: string | null } | null }).trip?.alias ?? null);
  return { ...access, alias };
}