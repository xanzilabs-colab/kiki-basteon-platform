import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { getPatternTime } from "@/lib/intelligence/patterns";
import { preferRoute, scoreRouteHints, summarizeRiskCells } from "@/lib/intelligence/riskHints";
import { requireTripUser } from "../_shared";

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const routeSchema = z.object({
  points: z.array(pointSchema).min(2).max(5_000),
  durationS: z.number().min(0).max(86_400),
});
const requestSchema = z.object({
  routes: z.array(routeSchema).min(1).max(5),
  selectedIndex: z.number().int().min(0).max(4).default(0),
  tripId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.selectedIndex >= parsed.data.routes.length) return NextResponse.json({ error: "invalid_selected_route" }, { status: 400 });

  const db = createAdminClient();
  const { data: allowed, error: limitError } = await db.rpc("consume_intelligence_limit", {
    p_user_id: access.user.id,
    p_action_key: "route_hints",
    p_limit: 8,
    p_window_seconds: 60,
  });
  if (limitError) return NextResponse.json({ error: limitError.message }, { status: 500 });
  if (!allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: settings, error: settingsError } = await db.from("user_intelligence_settings")
    .select("route_hints_enabled,share_hints_with_buddies")
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
  if (!settings?.route_hints_enabled) return NextResponse.json({ hints: [], preferredIndex: parsed.data.selectedIndex, alternatives: [], message: "Route hints are turned off." });

  if (parsed.data.tripId) {
    const { data: trip, error: tripError } = await db.from("trips").select("id")
      .eq("id", parsed.data.tripId)
      .eq("owner_id", access.user.id)
      .maybeSingle();
    if (tripError) return NextResponse.json({ error: tripError.message }, { status: 500 });
    if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  }

  const allPoints = parsed.data.routes.flatMap((route) => route.points);
  const minLat = Math.max(-90, Math.min(...allPoints.map((point) => point.lat)) - 0.02);
  const maxLat = Math.min(90, Math.max(...allPoints.map((point) => point.lat)) + 0.02);
  const minLng = Math.max(-180, Math.min(...allPoints.map((point) => point.lng)) - 0.02);
  const maxLng = Math.min(180, Math.max(...allPoints.map((point) => point.lng)) + 0.02);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();

  const [{ data: reports, error: reportsError }, { data: safePlaces, error: safePlacesError }] = await Promise.all([
    db.from("buddy_community_alerts").select("id,lat,lng,kind,created_at,expires_at,reporter_id")
      .gte("lat", minLat).lte("lat", maxLat).gte("lng", minLng).lte("lng", maxLng)
      .gte("created_at", cutoff).gt("expires_at", now.toISOString()).is("resolved_at", null).limit(500),
    db.from("safe_places").select("lat,lng,active,review_status,reverify_by,open_24h")
      .gte("lat", minLat).lte("lat", maxLat).gte("lng", minLng).lte("lng", maxLng)
      .eq("active", true).eq("review_status", "approved").limit(500),
  ]);
  if (reportsError || safePlacesError) return NextResponse.json({ error: reportsError?.message ?? safePlacesError?.message }, { status: 500 });
  const reportRows = reports ?? [];
  const safeSpotRows = safePlaces ?? [];
  const reportIds = reportRows.map((row) => row.id);
  const { data: votes, error: voteError } = reportIds.length
    ? await db.from("buddy_community_alert_votes").select("alert_id,user_id").in("alert_id", reportIds)
    : { data: [], error: null };
  if (voteError) return NextResponse.json({ error: voteError.message }, { status: 500 });
  const votesByReport = new Map<string, Set<string>>();
  for (const vote of votes ?? []) {
    const voterSet = votesByReport.get(vote.alert_id) ?? new Set<string>();
    voterSet.add(vote.user_id);
    votesByReport.set(vote.alert_id, voterSet);
  }
  const enrichedReports = reportRows.map((report) => ({
    ...report,
    upvotes: Math.min(3, votesByReport.get(report.id)?.size ?? 0),
  }));

  const recommended = preferRoute(parsed.data.routes, enrichedReports, safeSpotRows, now);
  const selectedRoute = parsed.data.routes[parsed.data.selectedIndex];
  const selectedHints = scoreRouteHints({ points: selectedRoute.points, reports: enrichedReports, safePlaces: safeSpotRows, now });
  const preferredIndex = recommended.preferredIndex;
  if (preferredIndex !== parsed.data.selectedIndex && recommended.alternatives[preferredIndex]?.riskScore < recommended.alternatives[parsed.data.selectedIndex]?.riskScore) {
    const preferredDuration = Math.max(1, Math.round(parsed.data.routes[preferredIndex].durationS / 60));
    selectedHints.unshift({
      hintType: "alternative_route",
      message: `Another similar-duration route has fewer recent reports nearby and takes about ${preferredDuration} minutes.`,
      severity: "info",
      confidence: 0.65,
      reason: { reportCount: 0, periodDays: 30, distinctReporters: 0, safeSpotsNearby: 0 },
    });
  }

  const bucket = getPatternTime(now);
  const allRouteCells = [...new Set(allPoints.map((point) => `${Math.round(point.lat * 100)}:${Math.round(point.lng * 100)}`))].slice(0, 200);
  const summaries = summarizeRiskCells({ points: allPoints, reports: enrichedReports, safePlaces: safeSpotRows, now })
    .filter((item) => allRouteCells.includes(item.cellId));
  if (summaries.length) {
    const { error: cellError } = await db.from("risk_cells").upsert(summaries.map((summary) => ({
      cell_id: summary.cellId,
      time_bucket: bucket.timeBucket,
      day_type: bucket.dayType,
      report_count: summary.reportCount,
      distinct_reporters: summary.distinctReporters,
      weighted_score: summary.weightedScore,
      safe_spot_density: summary.safeSpotDensity,
      last_computed: now.toISOString(),
    })), { onConflict: "cell_id,time_bucket,day_type" });
    if (cellError) return NextResponse.json({ error: cellError.message }, { status: 500 });
  }

  const expiresAt = new Date(now.getTime() + 2 * 60 * 60_000).toISOString();
  const savedHints: Array<{ id: string; hintType: string; message: string; severity: string; confidence: number; reason: unknown }> = [];
  for (const hint of selectedHints) {
    let hintId: string | null = null;
    if (parsed.data.tripId) {
      const { data: previousHint, error: previousError } = await db.from("safety_hints").select("id")
        .eq("user_id", access.user.id).eq("trip_id", parsed.data.tripId).eq("hint_type", hint.hintType)
        .gt("expires_at", now.toISOString()).maybeSingle();
      if (previousError) return NextResponse.json({ error: previousError.message }, { status: 500 });
      if (previousHint) hintId = previousHint.id;
    }
    if (!hintId) {
      const { data: saved, error: saveError } = await db.from("safety_hints").insert({
        user_id: access.user.id,
        audience: "self",
        trip_id: parsed.data.tripId ?? null,
        hint_type: hint.hintType,
        message: hint.message,
        reason: hint.reason,
        severity: hint.severity,
        confidence: hint.confidence,
        expires_at: expiresAt,
      }).select("id").single();
      if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
      hintId = saved.id;
    }
    if (!hintId) return NextResponse.json({ error: "Could not save a route hint." }, { status: 500 });
    savedHints.push({ id: hintId, hintType: hint.hintType, message: hint.message, severity: hint.severity, confidence: hint.confidence, reason: hint.reason });
  }

  if (settings.share_hints_with_buddies && savedHints.length) {
    const { data: contacts, error: contactsError } = await db.from("buddy_contacts").select("contact_user_id").eq("user_id", access.user.id);
    if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });
    const contactIds = [...new Set((contacts ?? []).map((row) => row.contact_user_id))];
    if (contactIds.length) {
      const [{ data: mutual }, { data: ownerBlocks }, { data: contactBlocks }] = await Promise.all([
        db.from("buddy_contacts").select("user_id").eq("contact_user_id", access.user.id).in("user_id", contactIds),
        db.from("buddy_blocks").select("blocked_user_id").eq("user_id", access.user.id).in("blocked_user_id", contactIds),
        db.from("buddy_blocks").select("user_id").eq("blocked_user_id", access.user.id).in("user_id", contactIds),
      ]);
      const mutualIds = new Set((mutual ?? []).map((row) => row.user_id));
      const blockedIds = new Set([
        ...(ownerBlocks ?? []).map((row) => row.blocked_user_id),
        ...(contactBlocks ?? []).map((row) => row.user_id),
      ]);
      const recipients = contactIds.filter((userId) => mutualIds.has(userId) && !blockedIds.has(userId));
      if (recipients.length) {
        const areaHint = savedHints.find((hint) => hint.severity === "caution") ?? savedHints[0];
        const shared = await createNotifications(recipients.map((userId) => ({
          userId,
          type: "system" as const,
          title: "A Buddy shared a safety tip",
          body: "Recent public information may be useful for an upcoming trip. Open Kiki if you would like to walk together.",
          href: "/account/buddies",
          payload: { action: "buddy_safety_hint", hintId: areaHint.id, response: "acknowledge_or_walk_with_me" },
        })), db);
        if (shared.length !== recipients.length) return NextResponse.json({ error: "Some Buddy safety-tip notifications could not be saved." }, { status: 500 });
      }
    }
  }

  return NextResponse.json({
    hints: savedHints,
    preferredIndex,
    alternatives: recommended.alternatives.map((item, index) => ({
      index,
      riskScore: Math.round(item.riskScore),
      durationMinutes: Math.max(1, Math.round(item.route.durationS / 60)),
    })),
    message: savedHints.length ? null : "No strong route hints yet. Community reports are limited and may be unverified.",
  });
}
