import { safeJson } from "@/lib/verification/http";
import { requireBubbleMember } from "./_shared";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireBubbleMember(id);
    if ("error" in access) return access.error;

    const [{ data: bubble, error: bubbleError }, { data: members, error: membersError }, { data: messages, error: messagesError }, { data: walk, error: walkError }] = await Promise.all([
      access.db.from("buddy_bubbles").select("meeting_code,closed_at,expires_at").eq("id", id).single(),
      access.db.from("buddy_bubble_members").select("user_id,trip_id,arrived_at,met_confirmed_at").eq("bubble_id", id).is("left_at", null),
      access.db.from("buddy_bubble_messages").select("sender_id,message_key,created_at").eq("bubble_id", id).order("created_at", { ascending: false }).limit(20),
      access.db.from("buddy_virtual_walks").select("id,status,caller_id").eq("bubble_id", id).in("status", ["ringing", "active"]).maybeSingle(),
    ]);
    if (bubbleError || membersError || messagesError || walkError) throw bubbleError ?? membersError ?? messagesError ?? walkError;
    if (!bubble) return safeJson({ error: "bubble_not_found" }, { status: 404 });

    const tripIds = [...new Set((members ?? []).flatMap((member) => member.trip_id ? [member.trip_id] : []))];
    const { data: trips, error: tripsError } = tripIds.length
      ? await access.db.from("buddy_trips").select("id,alias,avatar").in("id", tripIds)
      : { data: [], error: null };
    if (tripsError) throw tripsError;
    const tripById = new Map((trips ?? []).map((trip) => [trip.id, trip]));
    const aliases = new Map((members ?? []).map((member) => [member.user_id, tripById.get(member.trip_id ?? "")?.alias ?? "Buddy"]));

    return safeJson({
      meetingCode: bubble.meeting_code,
      closed: Boolean(bubble.closed_at),
      expiresAt: bubble.expires_at,
      members: (members ?? []).map((member) => ({ alias: aliases.get(member.user_id) ?? "Buddy", avatar: tripById.get(member.trip_id ?? "")?.avatar ?? "", arrived: Boolean(member.arrived_at), met: Boolean(member.met_confirmed_at), you: member.user_id === access.user.id })),
      messages: (messages ?? []).map((message) => ({ message_key: message.message_key, created_at: message.created_at, sender: message.sender_id === access.user.id ? "You" : aliases.get(message.sender_id) ?? "Buddy" })),
      virtualWalk: walk ? { id: walk.id, status: walk.status, incoming: walk.caller_id !== access.user.id } : null,
    });
  } catch (error) {
    console.error("Buddy bubble read failed", error);
    return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  }
}