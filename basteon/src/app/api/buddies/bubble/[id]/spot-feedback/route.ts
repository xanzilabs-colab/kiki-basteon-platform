import { z } from "zod";
import { feedbackSchema } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../../../_meeting";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { client } = await meetingSession(request);
    const { id } = await params;
    const body = await meetingBody(request, feedbackSchema);
    if (!body || !z.string().uuid().safeParse(id).success) return meetingJson({ error: "invalid_request" }, 400);
    await meetingRpc(client, "feedback_bubble_spot", { p_bubble_id: id, p_round: body.round, p_candidate_id: body.candidateId, p_reason: body.reason });
    return meetingJson({ ok: true });
  } catch (error) { return meetingError(error); }
}