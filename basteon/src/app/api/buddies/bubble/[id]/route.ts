import { safeJson } from "@/lib/verification/http";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return safeJson({ error: "unauthenticated" }, { status: 401 });
    const { data, error } = await client.rpc("read_buddy_bubble", { p_bubble_id: id });
    if (error || !data) return safeJson({ error: "bubble_unavailable" }, { status: 503 });
    const bubble = data as {
      meetingCode: string;
      closed: boolean;
      expiresAt: string;
      members: Array<{ userId: string; arrived: boolean; met: boolean }>;
      messages: Array<{ senderId: string; messageKey: string; createdAt: string }>;
    };

    return safeJson({
      meetingCode: bubble.meetingCode,
      closed: bubble.closed,
      expiresAt: bubble.expiresAt,
      members: bubble.members.map((member) => ({ alias: member.userId === user.id ? "You" : "Buddy", avatar: "", arrived: member.arrived, met: member.met, you: member.userId === user.id })),
      messages: bubble.messages.map((message) => ({ message_key: message.messageKey, created_at: message.createdAt, sender: message.senderId === user.id ? "You" : "Buddy" })),
      virtualWalk: null,
    });
  } catch (error) {
    console.error("Buddy bubble read failed", error);
    return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  }
}