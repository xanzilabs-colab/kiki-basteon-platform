import { z } from "zod";
import { sameOrigin, safeJson } from "@/lib/verification/http";
import { activeBuddyTrip, requireBuddyUser } from "../../_shared";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return safeJson({ error: "invalid_position" }, { status: 400 });
  const trip = await activeBuddyTrip(access.db, access.user.id);
  if (!trip) return safeJson({ error: "no_active_trip" }, { status: 409 });
  await access.db.from("buddy_trips").update({ last_lat: input.data.lat, last_lng: input.data.lng, last_position_at: new Date().toISOString() }).eq("id", trip.id);
  return safeJson({ ok: true });
}