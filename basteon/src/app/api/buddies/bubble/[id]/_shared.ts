import "server-only";
import { safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../../_shared";

export async function requireBubbleMember(bubbleId: string) {
  const access = await requireBuddyUser();
  if ("error" in access) return access;
  const { data: member } = await access.db.from("buddy_bubble_members").select("bubble_id").eq("bubble_id", bubbleId).eq("user_id", access.user.id).maybeSingle();
  if (!member) return { error: safeJson({ error: "bubble_not_found" }, { status: 404 }) } as const;
  return access;
}