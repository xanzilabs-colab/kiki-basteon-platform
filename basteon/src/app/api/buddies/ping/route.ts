import { z } from "zod";
import { canPing, resolveRef } from "@/lib/buddies";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { BUDDIES_REQUIRE_VERIFICATION } from "@/lib/verification/config";
import { safeJson, sameOrigin } from "@/lib/verification/http";
import { buddyHmacSecret, currentBuddyView, requireBuddyUser } from "../_shared";

const schema = z.object({ ref: z.string().length(16) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser(); if ("error" in access) return access.error;
  if (BUDDIES_REQUIRE_VERIFICATION) try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  const input = schema.safeParse(await request.json().catch(() => null)); if (!input.success) return safeJson({ error: "invalid_ping" }, { status: 400 });
  const view = await currentBuddyView(access.db, access.user.id); if (!view) return safeJson({ error: "no_active_trip" }, { status: 409 });
  const target = resolveRef(buddyHmacSecret(), access.user.id, view.result.avatars, view.candidates, input.data.ref);
  if (!target) return safeJson({ error: "target_not_available" }, { status: 404 });
  const { count: pingsToday } = await access.db.from("buddy_pings").select("id", { count: "exact", head: true }).eq("from_trip_id", view.trip.id).gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  const { data: previous } = await access.db.from("buddy_pings").select("last_declined_at").eq("from_trip_id", view.trip.id).eq("to_trip_id", target.tripId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const decision = canPing({ pingsToday: pingsToday ?? 0, pingsToThisTargetThisTrip: previous ? 1 : 0, lastDeclinedAt: previous?.last_declined_at ? new Date(previous.last_declined_at).getTime() : null, blockedEitherWay: false }, Date.now());
  if (!decision.ok) return safeJson({ error: decision.reason ?? "ping_unavailable" }, { status: 429 });
  await access.db.from("buddy_pings").insert({ from_trip_id: view.trip.id, to_trip_id: target.tripId });
  return safeJson({ sent: true });
}