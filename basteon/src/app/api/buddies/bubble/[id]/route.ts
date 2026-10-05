// Replace your existing file: app/api/buddies/bubble/[id]/route.ts  (GET handler only)
// No safeJson, no service-role client: only the signed-in user's client + the RPC.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type RawMember = { userId?: unknown; arrived?: unknown; met?: unknown };
type RawMessage = { senderId?: unknown; messageKey?: unknown; createdAt?: unknown };
type RawWalk = { id?: unknown; status?: unknown; callerId?: unknown; calleeId?: unknown; stale?: unknown };
type RawBubble = { meetingCode?: unknown; closed?: unknown; expiresAt?: unknown; members?: unknown; messages?: unknown; virtualWalk?: RawWalk | null; stale?: unknown };

// `stage` + `detail` are debugging aids. Once it works, remove `detail` from the response.
function fail(status: number, stage: string, detail?: string) {
  return NextResponse.json({ error: "bubble_unavailable", stage, detail: detail ?? null }, { status, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let stage = "start";
  try {
    stage = "params";
    const { id } = await params;

    stage = "supabase_client";
    const client = await createClient();

    stage = "auth";
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

    stage = "rpc";
    const { data, error } = await client.rpc("read_buddy_bubble", { p_bubble_id: id });
    if (error || !data) {
      console.error("read_buddy_bubble failed", { code: error?.code, message: error?.message });
      const notMember = error?.message?.includes("not_bubble_member") ?? false;
      return fail(notMember ? 403 : 503, stage, error?.message);
    }

    stage = "map";
    const bubble = data as RawBubble;
    const members = Array.isArray(bubble.members) ? (bubble.members as RawMember[]) : [];
    const messages = Array.isArray(bubble.messages) ? (bubble.messages as RawMessage[]) : [];
    const walk = bubble.virtualWalk;

    return NextResponse.json(
      {
        meetingCode: typeof bubble.meetingCode === "string" ? bubble.meetingCode : "",
        closed: bubble.closed === true,
        expiresAt: typeof bubble.expiresAt === "string" ? bubble.expiresAt : null,
        members: members.map((m) => ({
          alias: m.userId === user.id ? "You" : "Buddy",
          avatar: "",
          arrived: m.arrived === true,
          met: m.met === true,
          you: m.userId === user.id,
        })),
        // RPC returns newest first; the UI appends, so send oldest first.
        messages: messages
          .slice()
          .reverse()
          .map((m) => ({
            message_key: typeof m.messageKey === "string" ? m.messageKey : "",
            created_at: typeof m.createdAt === "string" ? m.createdAt : new Date(0).toISOString(),
            sender: m.senderId === user.id ? "You" : "Buddy",
          })),
        userId: user.id,
        stale: bubble.stale === true,
        virtualWalk: walk && typeof walk.id === "string" && typeof walk.callerId === "string" && (walk.status === "ringing" || walk.status === "active") ? {
          id: walk.id, status: walk.status, callerId: walk.callerId,
          calleeId: typeof walk.calleeId === "string" ? walk.calleeId : null,
          incoming: walk.status === "ringing" && walk.callerId !== user.id,
          stale: walk.stale === true,
        } : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error(`Buddy bubble read crashed at stage "${stage}"`, error);
    return fail(500, stage, error instanceof Error ? error.message : String(error));
  }
}