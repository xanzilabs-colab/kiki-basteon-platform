import { z } from "zod";
import { createNotifications } from "@/lib/notifications";
import { createMeetingCode } from "@/lib/buddies/meetingCode";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { BUDDIES_REQUIRE_VERIFICATION } from "@/lib/verification/config";
import { safeJson, sameOrigin } from "@/lib/verification/http";
import { recordBuddyAudit } from "../../_audit";
import { activeBuddyTrip, requireBuddyUser } from "../../_shared";

const schema = z.object({ pingId: z.string().uuid(), action: z.enum(["accept", "decline"]) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser(); if ("error" in access) return access.error;
  if (BUDDIES_REQUIRE_VERIFICATION) try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return safeJson({ error: "invalid_response" }, { status: 400 });
  const trip = await activeBuddyTrip(access.db, access.user.id); if (!trip) return safeJson({ error: "no_active_trip" }, { status: 409 });
  const { data: ping } = await access.db.from("buddy_pings").select("*").eq("id", input.data.pingId).eq("to_trip_id", trip.id).eq("status", "pending").maybeSingle();
  if (!ping) return safeJson({ error: "ping_not_found" }, { status: 404 });
  if (input.data.action === "decline") { await access.db.from("buddy_pings").update({ status: "declined", last_declined_at: new Date().toISOString(), responded_at: new Date().toISOString() }).eq("id", ping.id); return safeJson({ ok: true }); }
  const { data: bubble, error } = await access.db.from("buddy_bubbles").insert({ meeting_code: createMeetingCode(), expires_at: new Date(Date.now() + 4 * 60 * 60_000).toISOString() }).select("id").single();
  if (error || !bubble) return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  const { data: sourceTrip } = await access.db.from("buddy_trips").select("user_id,alias").eq("id", ping.from_trip_id).single();
  await access.db.from("buddy_bubble_members").insert([{ bubble_id: bubble.id, user_id: access.user.id, trip_id: trip.id }, { bubble_id: bubble.id, user_id: sourceTrip!.user_id, trip_id: ping.from_trip_id }]);
  const actorAlias = typeof trip.alias === "string" ? trip.alias : null;
  await recordBuddyAudit(access.db, { bubbleId: bubble.id, tripId: trip.id, actorId: access.user.id, actorAlias, event: "bubble_created" });
  await recordBuddyAudit(access.db, { bubbleId: bubble.id, tripId: trip.id, actorId: access.user.id, actorAlias, event: "member_joined" });
  await recordBuddyAudit(access.db, { bubbleId: bubble.id, tripId: ping.from_trip_id, actorId: sourceTrip!.user_id, actorAlias: sourceTrip!.alias, event: "member_joined" });
  await access.db.from("buddy_pings").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", ping.id);
  const href = `/account/buddies/bubble/${bubble.id}`;
  await createNotifications([access.user.id, sourceTrip!.user_id as string].map((userId) => ({ userId, type: "buddy_bubble" as const, title: "Buddy bubble ready", body: "Your Buddy request was accepted. Open the bubble for your meeting code.", href, payload: { bubbleId: bubble.id as string } })), access.db);
  return safeJson({ bubble: true, bubbleId: bubble.id });
}