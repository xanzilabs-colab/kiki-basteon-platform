import { z } from "zod";
import { meetingError, meetingJson, meetingRpc, meetingSession } from "../../../_meeting";

const idSchema = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return meetingJson({ error: "not_found" }, 404);
    const { client } = await meetingSession(request);
    return meetingJson(await meetingRpc(client, "toggle_community_alert_vote", { p_alert_id: id.data }));
  } catch (error) { return meetingError(error); }
}