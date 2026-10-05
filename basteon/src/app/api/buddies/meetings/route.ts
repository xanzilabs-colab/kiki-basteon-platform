import { meetingError, meetingJson, meetingRpc, meetingSession } from "../_meeting";

export async function GET(request: Request) {
  try {
    const { client } = await meetingSession(request);
    return meetingJson({ bubbles: await meetingRpc(client, "list_buddy_meeting_bubbles") });
  } catch (error) { return meetingError(error); }
}