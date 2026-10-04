import { z } from "zod";
import { canPing, resolveRef } from "@/lib/buddies";
import { createMeetingCode } from "@/lib/buddies/meetingCode";
import { createNotifications } from "@/lib/notifications";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { BUDDIES_REQUIRE_VERIFICATION } from "@/lib/verification/config";
import { safeJson, sameOrigin } from "@/lib/verification/http";
import { recordBuddyAudit } from "../_audit";
import { buddyHmacSecret, currentBuddyView, requireBuddyUser } from "../_shared";

const schema = z.object({ ref: z.string().length(16) });
const BUBBLE_TTL_MS = 4 * 60 * 60_000;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser(); if ("error" in access) return access.error;
  if (BUDDIES_REQUIRE_VERIFICATION) try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return safeJson({ error: "invalid_join" }, { status: 400 });
  const view = await currentBuddyView(access.db, access.user.id); if (!view) return safeJson({ error: "no_active_trip" }, { status: 409 });
  const target = resolveRef(buddyHmacSecret(), access.user.id, view.result.avatars, view.candidates, input.data.ref);
  if (!target) return safeJson({ error: "target_not_available" }, { status: 404 });

  const now = Date.now();
  const [{ count: joinsToday }, { data: previous }] = await Promise.all([
    access.db.from("buddy_pings").select("id", { count: "exact", head: true }).eq("from_trip_id", view.trip.id).gte("created_at", new Date(now - 24 * 60 * 60_000).toISOString()),
    access.db.from("buddy_pings").select("last_declined_at").eq("from_trip_id", view.trip.id).eq("to_trip_id", target.tripId).not("last_declined_at", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const decision = canPing({ pingsToday: joinsToday ?? 0, pingsToThisTargetThisTrip: 0, lastDeclinedAt: previous?.last_declined_at ? new Date(previous.last_declined_at).getTime() : null, blockedEitherWay: false }, now);
  if (!decision.ok) return safeJson({ error: decision.reason ?? "join_unavailable" }, { status: 429 });

  const { data, error } = await access.db.rpc("join_buddy_bubble", {
    p_joiner: access.user.id, p_joiner_trip: view.trip.id, p_target: target.userId, p_target_trip: target.tripId,
    p_meeting_code: createMeetingCode(), p_expires_at: new Date(now + BUBBLE_TTL_MS).toISOString(),
  });
  const row = (Array.isArray(data) ? data[0] : data) as { joined_bubble_id?: string; created?: boolean; already_member?: boolean } | null;
  if (error || !row?.joined_bubble_id) return safeJson({ error: "bubble_unavailable" }, { status: 500 });
  const bubbleId = row.joined_bubble_id;

  if (!row.already_member) {
    const actorAlias = typeof view.trip.alias === "string" ? view.trip.alias : null;
    const eventBase = { bubbleId, tripId: view.trip.id, actorId: access.user.id, actorAlias };
    if (row.created) await recordBuddyAudit(access.db, { ...eventBase, event: "bubble_created" });
    await recordBuddyAudit(access.db, { ...eventBase, event: "member_joined" });
    await access.db.from("buddy_pings").insert({ from_trip_id: view.trip.id, to_trip_id: target.tripId, status: "accepted", responded_at: new Date().toISOString() });
    const href = `/account/buddies/bubble/${bubbleId}`;
    const payload = { bubbleId };
    await createNotifications([
      { userId: access.user.id, type: "buddy_bubble", title: "You joined a Buddy bubble", body: `You're in a private bubble with ${target.nickname}. Open it for your meeting code.`, href, payload },
      { userId: target.userId, type: "buddy_bubble", title: "A Buddy joined you", body: `${view.viewer.nickname} joined your Buddy bubble. Open it to meet safely.`, href, payload },
    ], access.db);
  }
  return safeJson({ joined: true, bubbleId, created: Boolean(row.created), alreadyMember: Boolean(row.already_member) });
}
