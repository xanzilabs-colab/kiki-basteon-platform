import { adminActionSchema } from "@/lib/buddies/meeting/schemas";
import { geocodeAddress } from "@/lib/geocoding";
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
    if (body.action === "create") {
      const location = await geocodeAddress(body.address);
      return meetingJson({ id: await meetingRpc(client, "admin_create_safe_place", { p_name: body.name, p_category: body.category, p_lat: location.lat, p_lng: location.lng, p_address: body.address, p_quality: body.quality, p_open_24h: body.open24h }) }, 201);
    }
    return meetingJson({ ok: true });
  } catch (error) { return meetingError(error); }
}