import { placeSchema, searchSchema } from "@/lib/buddies/meeting/schemas";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../_meeting";

export async function GET(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const query = new URL(request.url).searchParams;
    const parsed = searchSchema.safeParse({ lat: query.has("lat") ? Number(query.get("lat")) : undefined, lng: query.has("lng") ? Number(query.get("lng")) : undefined, radius: query.has("radius") ? Number(query.get("radius")) : undefined });
    if (!parsed.success) return meetingJson({ error: "invalid_location" }, 400);
    const { lat, lng, radius } = parsed.data;
    return meetingJson({ places: await meetingRpc(client, "list_meetup_candidates_near", { p_lat: lat, p_lng: lng, p_radius_m: radius }) });
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const body = await meetingBody(request, placeSchema);
    if (!body) return meetingJson({ error: "invalid_place" }, 400);
    const id = await meetingRpc(client, "suggest_safe_place", { p_name: body.name, p_category: body.category, p_lat: body.lat, p_lng: body.lng, p_address: body.address ?? null });
    return meetingJson({ id, status: "pending" }, 201);
  } catch (error) { return meetingError(error); }
}