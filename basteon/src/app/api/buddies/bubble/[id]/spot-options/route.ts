import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMeetingEngine } from "@/lib/buddies/meeting/server";
import { spotActionSchema } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../../../_meeting";

type Context = { params: Promise<{ id: string }> };
export const maxDuration = 60;

export async function GET(request: Request, context: Context) {
  try {
    const { client } = await meetingSession(request);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return meetingJson({ error: "invalid_bubble" }, 400);
    return meetingJson(await meetingRpc(client, "get_bubble_meeting", { p_bubble_id: id }));
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { client, user } = await meetingSession(request);
    const { id } = await context.params;
    const body = await meetingBody(request, spotActionSchema);
    if (!body || !z.string().uuid().safeParse(id).success) return meetingJson({ error: "invalid_request" }, 400);
    if (body.action === "location") await meetingRpc(client, "set_bubble_meeting_location", { p_bubble_id: id, p_lat: body.lat, p_lng: body.lng, p_allow_landmarks: body.allowLandmarks });
    if (body.action === "vote") await meetingRpc(client, "vote_bubble_spot", { p_bubble_id: id, p_round: body.round, p_candidate_id: body.candidateId });
    if (body.action === "generate") {
      const current = await meetingRpc(client, "get_bubble_meeting", { p_bubble_id: id }) as { round?: number; candidates?: unknown[]; membershipChanged?: boolean } | null;
      if (current?.round && !body.regenerate && !current.membershipChanged) return meetingJson({ status: "ok", round: current.round, count: current.candidates?.length ?? 0 });
      return meetingJson(await runMeetingEngine({ userClient: client, serviceClient: createAdminClient(), userId: user.id, bubbleId: id, regenerate: body.regenerate || current?.membershipChanged === true }));
    }
    return meetingJson({ ok: true });
  } catch (error) { return meetingError(error); }
}