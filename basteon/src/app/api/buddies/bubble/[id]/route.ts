import { safeJson } from "@/lib/verification/http";
import { requireBubbleMember } from "./_shared";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const access = await requireBubbleMember(id); if ("error" in access) return access.error;
  const [{ data: bubble }, { data: members }, { data: messages }, { data: walk }] = await Promise.all([
    access.db.from("buddy_bubbles").select("meeting_code,closed_at,expires_at").eq("id", id).single(),
    access.db.from("buddy_bubble_members").select("user_id,arrived_at,met_confirmed_at").eq("bubble_id", id),
    access.db.from("buddy_bubble_messages").select("message_key,created_at").eq("bubble_id", id).order("created_at", { ascending: false }).limit(20),
    access.db.from("buddy_virtual_walks").select("id,status,caller_id").eq("bubble_id", id).in("status", ["ringing", "active"]).maybeSingle(),
  ]);
  if (!bubble) return safeJson({ error: "bubble_not_found" }, { status: 404 });
  return safeJson({ meetingCode: bubble.meeting_code, closed: Boolean(bubble.closed_at), expiresAt: bubble.expires_at, members: (members ?? []).map((member) => ({ arrived: Boolean(member.arrived_at), met: Boolean(member.met_confirmed_at), you: member.user_id === access.user.id })), messages: messages ?? [], virtualWalk: walk ? { id: walk.id, status: walk.status, incoming: walk.caller_id !== access.user.id } : null });
}