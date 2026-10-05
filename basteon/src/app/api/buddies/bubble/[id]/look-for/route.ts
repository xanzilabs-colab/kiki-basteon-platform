import { z } from "zod";
import { lookForSchema } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../../../_meeting";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { client } = await meetingSession(request);
    const { id } = await params;
    const body = await meetingBody(request, lookForSchema);
    if (!body || !z.string().uuid().safeParse(id).success) return meetingJson({ error: "invalid_request" }, 400);
    await meetingRpc(client, "set_bubble_look_for", { p_bubble_id: id, p_top_color: body.topColor, p_carrying_bag: body.carryingBag });
    return meetingJson({ ok: true });
  } catch (error) { return meetingError(error); }
}