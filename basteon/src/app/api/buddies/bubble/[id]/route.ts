import { safeJson } from "@/lib/verification/http";
import { requireBubbleMember } from "./_shared";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireBubbleMember(id);
    if ("error" in access) return access.error;

    const [{ data: bubble, error: bubbleError }, { data: members, error: membersError }, { data: messages, error: messagesError }, { data: walks, error: walksError }] = await Promise.all([
      access.db.from("buddy_bubbles").select("meeting_code,closed_at,expires_at").eq("id", id).single(),
      access.db.from("buddy_bubble_members").select("user_id,trip_id,arrived_at,met_confirmed_at").eq("bubble_id", id).is("left_at", null),
      access.db.from("buddy_bubble_messages").select("sender_id,message_key,created_at").eq("bubble_id", id).order("created_at", { ascending: false }).limit(20),
      access.db.from("buddy_virtual_walks").select("id,status,caller_id").eq("bubble_id", id).in("status", ["ringing", "active"]).order("created_at", { ascending: false }).limit(1),
    ]);
    if (bubbleError || membersError) throw bubbleError ?? membersError;
    if (!bubble) return safeJson({ error: "bubble_not_found" }, { status: 404 });

    if (messagesError) console.warn("Buddy Bubble message read failed", messagesError);
    if (walksError) console.warn("Buddy virtual walk read failed", walksError);
    const memberTripIds = [...new Set((members ?? []).flatMap((member) => member.trip_id ? [member.trip_id] : []))];
    const { data: trips, error: tripsError } = memberTripIds.length
      ? await access.db.from("buddy_trips").select("id,alias,avatar").in("id", memberTripIds)
      : { data: [], error: null };
    if (tripsError) console.warn("Buddy Bubble member alias read failed", tripsError);
    const tripsById = new Map((trips ?? []).map((trip) => [trip.id, trip]));
    const memberAliases = new Map((members ?? []).map((member) => [member.user_id, tripsById.get(member.trip_id ?? "")?.alias ?? "Buddy"]));
    const walk = walks?.[0] ?? null;

    return safeJson({
      meetingCode: bubble.meeting_code,
      closed: Boolean(bubble.closed_at),
      expiresAt: bubble.expires_at,
      members: (members ?? []).map((member) => {
        const trip = tripsById.get(member.trip_id ?? "");
        return { alias: member.user_id === access.user.id ? "You" : trip?.alias ?? "Buddy", avatar: trip?.avatar ?? "", arrived: Boolean(member.arrived_at), met: Boolean(member.met_confirmed_at), you: member.user_id === access.user.id };
      }),
      messages: (messages ?? []).map((message) => ({ message_key: message.message_key, created_at: message.created_at, sender: message.sender_id === access.user.id ? "You" : memberAliases.get(message.sender_id) ?? "Buddy" })),
      virtualWalk: walk ? { id: walk.id, status: walk.status, incoming: walk.caller_id !== access.user.id } : null,
    });
  } catch (error) {
    console.error("Buddy bubble read failed", error);
    return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  }
}