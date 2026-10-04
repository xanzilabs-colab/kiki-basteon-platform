import { BUDDY_CONFIG, buildNearbyView, evaluateQueryPattern } from "@/lib/buddies";
import { snapToCell } from "@/lib/buddies/geo";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { safeJson } from "@/lib/verification/http";
import { activeBuddyTrip, buddyHmacSecret, presenceForTrip, requireBuddyUser } from "../_shared";

export async function GET() {
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  if (!access.verified) return safeJson({ error: "not_verified" }, { status: 403 });
  try { await requireFreshFaceProof(access.user.id); } catch { return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 }); }
  const viewerTrip = await activeBuddyTrip(access.db, access.user.id);
  if (!viewerTrip) return safeJson({ avatars: [] });
  const viewer = await presenceForTrip(access.db, viewerTrip);
  if (!viewer) return safeJson({ avatars: [] });
  const now = Date.now();
  const { data: logs } = await access.db.from("buddy_query_log").select("queried_at,snapped_lat,snapped_lng,refs,bands").eq("viewer_trip_id", viewerTrip.id).gte("queried_at", new Date(now - 24 * 60 * 60_000).toISOString()).order("queried_at", { ascending: true });
  const pattern = evaluateQueryPattern((logs ?? []).map((log) => ({ t: new Date(log.queried_at).getTime(), viewer: { lat: log.snapped_lat, lng: log.snapped_lng }, refs: log.refs as string[], bands: log.bands as Record<string, number> })), now);
  if (pattern.action === "throttle") return safeJson({ error: "refresh_limited" }, { status: 429 });
  if (pattern.action === "block") {
    await access.db.from("buddy_moderation_flags").insert({ user_id: access.user.id, kind: "nearby_harvesting_block", detail: { reasons: pattern.reasons } });
    return safeJson({ error: "moderation_review" }, { status: 403 });
  }
  const { data: rows } = await access.db.from("buddy_trips").select("*").eq("active", true).eq("visible", true).gt("expires_at", new Date().toISOString()).limit(100);
  const candidates = (await Promise.all((rows ?? []).map((row) => presenceForTrip(access.db, row)))).filter((presence): presence is NonNullable<typeof presence> => Boolean(presence));
  const { data: states } = await access.db.from("buddy_pair_states").select("target_trip_id,state").eq("viewer_trip_id", viewerTrip.id);
  const pairStates = Object.fromEntries((states ?? []).map((state) => [`${viewerTrip.id}|${state.target_trip_id}`, state.state]));
  const result = buildNearbyView({ viewer, now, secret: buddyHmacSecret(), pairStates }, candidates);
  await Promise.all(Object.entries(result.nextPairStates).map(async ([key, state]) => {
    const targetTripId = key.split("|")[1];
    await access.db.from("buddy_pair_states").upsert({ viewer_trip_id: viewerTrip.id, target_trip_id: targetTripId, state, updated_at: new Date().toISOString() });
  }));
  const snapped = snapToCell(viewer.position, BUDDY_CONFIG.cellSizeM).center;
  const refs = result.avatars.map((avatar) => avatar.ref);
  const bands = Object.fromEntries(result.avatars.map((avatar) => [avatar.ref, avatar.ring]));
  await access.db.from("buddy_query_log").insert({ viewer_trip_id: viewerTrip.id, snapped_lat: snapped.lat, snapped_lng: snapped.lng, refs, bands });
  if (pattern.action === "flag") await access.db.from("buddy_moderation_flags").insert({ user_id: access.user.id, kind: "nearby_tracking_pattern", detail: { reasons: pattern.reasons } });
  return safeJson({ avatars: result.avatars });
}