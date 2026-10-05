import { adminActionSchema } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../../buddies/_meeting";

export async function GET(request: Request) {
  try {
    const { client } = await meetingSession(request, true);
    return meetingJson(await meetingRpc(client, "admin_list_buddy_places"));
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request) {
  try {
    const { client } = await meetingSession(request, true);
    const body = await meetingBody(request, adminActionSchema);
    if (!body) return meetingJson({ error: "invalid_request" }, 400);
    if (body.action === "resolve") await meetingRpc(client, "admin_resolve_community_alert", { p_id: body.id });
    if (body.action === "review") await meetingRpc(client, "admin_review_safe_place", { p_id: body.id, p_status: body.status, p_quality: body.quality, p_active: body.active, p_open_24h: body.open24h });
    if (body.action === "create") return meetingJson({ id: await meetingRpc(client, "admin_create_safe_place", { p_name: body.name, p_category: body.category, p_lat: body.lat, p_lng: body.lng, p_address: body.address ?? null, p_quality: body.quality, p_open_24h: body.open24h }) }, 201);
    return meetingJson({ ok: true });
  } catch (error) { return meetingError(error); }
}