import { alertSchema, coordinates } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../_meeting";

export async function GET(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const query = new URL(request.url).searchParams;
    const parsed = coordinates.safeParse({ lat: query.has("lat") ? Number(query.get("lat")) : undefined, lng: query.has("lng") ? Number(query.get("lng")) : undefined });
    if (!parsed.success) return meetingJson({ error: "invalid_location" }, 400);
    const { lat, lng } = parsed.data;
    return meetingJson({ alerts: await meetingRpc(client, "list_community_alerts", { p_min_lat: Math.max(-90, lat - 0.1), p_max_lat: Math.min(90, lat + 0.1), p_min_lng: Math.max(-180, lng - 0.1), p_max_lng: Math.min(180, lng + 0.1) }) });
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const body = await meetingBody(request, alertSchema);
    if (!body) return meetingJson({ error: "invalid_alert" }, 400);
    return meetingJson({ id: await meetingRpc(client, "report_community_alert", { p_kind: body.kind, p_lat: body.lat, p_lng: body.lng }) }, 201);
  } catch (error) { return meetingError(error); }
}