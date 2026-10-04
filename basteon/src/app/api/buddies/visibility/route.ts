import { z } from "zod";
import { invalidateFaceProof, requireFreshFaceProof } from "@/lib/verification/service";
import { sameOrigin, safeJson } from "@/lib/verification/http";
import { activeBuddyTrip, requireBuddyUser } from "../_shared";

const schema = z.object({ visible: z.boolean() });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return safeJson({ error: "invalid_visibility" }, { status: 400 });
  const trip = await activeBuddyTrip(access.db, access.user.id);
  if (!trip) return safeJson({ error: "no_active_trip" }, { status: 409 });
  if (input.data.visible) {
    try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  } else await invalidateFaceProof(access.user.id);
  await access.db.from("buddy_trips").update({ visible: input.data.visible }).eq("id", trip.id);
  return safeJson({ visible: input.data.visible });
}