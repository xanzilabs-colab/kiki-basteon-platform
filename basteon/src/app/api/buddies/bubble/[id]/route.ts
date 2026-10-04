import { safeJson } from "@/lib/verification/http";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let rpcData: unknown;
  try {
    const { id } = await params;
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return safeJson({ error: "unauthenticated" }, { status: 401 });
    const { data, error } = await client.rpc("read_buddy_bubble", { p_bubble_id: id });
    rpcData = data;
    if (error || !data) {
      console.error("Buddy bubble RPC failed", { message: error?.message, details: error?.details, code: error?.code, data: JSON.stringify(data) });
      return safeJson({ error: "bubble_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const bubble = data as { meetingCode?: unknown; closed?: unknown; expiresAt?: unknown; members?: unknown; messages?: unknown };
    const members = Array.isArray(bubble.members) ? bubble.members : [];
    const messages = Array.isArray(bubble.messages) ? bubble.messages : [];

    return safeJson({
      meetingCode: typeof bubble.meetingCode === "string" ? bubble.meetingCode : "",
      closed: bubble.closed === true,
      expiresAt: typeof bubble.expiresAt === "string" ? bubble.expiresAt : null,
      members: members.map((member) => {
        const value = member as { userId?: unknown; arrived?: unknown; met?: unknown };
        return { alias: value.userId === user.id ? "You" : "Buddy", avatar: "", arrived: value.arrived === true, met: value.met === true, you: value.userId === user.id };
      }),
      messages: messages.slice().reverse().map((message) => {
        const value = message as { senderId?: unknown; messageKey?: unknown; createdAt?: unknown };
        return { message_key: typeof value.messageKey === "string" ? value.messageKey : "", created_at: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(), sender: value.senderId === user.id ? "You" : "Buddy" };
      }),
      virtualWalk: null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Buddy bubble read failed", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, data: JSON.stringify(rpcData) });
    return safeJson({ error: "bubble_unavailable" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}