import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { safeJson, sameOrigin } from "@/lib/verification/http";
import { activeBuddyTrip, requireBuddyUser } from "../../_shared";

const schema = z.object({ pingId: z.string().uuid(), action: z.enum(["accept", "decline"]) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser(); if ("error" in access) return access.error;
  try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return safeJson({ error: "invalid_response" }, { status: 400 });
  const trip = await activeBuddyTrip(access.db, access.user.id); if (!trip) return safeJson({ error: "no_active_trip" }, { status: 409 });
  const { data: ping } = await access.db.from("buddy_pings").select("*").eq("id", input.data.pingId).eq("to_trip_id", trip.id).eq("status", "pending").maybeSingle();
  if (!ping) return safeJson({ error: "ping_not_found" }, { status: 404 });
  if (input.data.action === "decline") { await access.db.from("buddy_pings").update({ status: "declined", last_declined_at: new Date().toISOString(), responded_at: new Date().toISOString() }).eq("id", ping.id); return safeJson({ ok: true }); }
  const { data: bubble, error } = await access.db.from("buddy_bubbles").insert({ meeting_code: randomBytes(6).toString("base64url"), expires_at: new Date(Date.now() + 4 * 60 * 60_000).toISOString() }).select("id").single();
  if (error || !bubble) return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  const { data: sourceTrip } = await access.db.from("buddy_trips").select("user_id").eq("id", ping.from_trip_id).single();
  await access.db.from("buddy_bubble_members").insert([{ bubble_id: bubble.id, user_id: access.user.id, trip_id: trip.id }, { bubble_id: bubble.id, user_id: sourceTrip!.user_id, trip_id: ping.from_trip_id }]);
  await access.db.from("buddy_pings").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", ping.id);
  return safeJson({ bubble: true });
}