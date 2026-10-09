import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { applyCheckInExtension, isWithinQuietHours, nextCheckInStage } from "@/lib/intelligence/checkins";
import { nextCheckInAt } from "@/lib/hamba/checkIn";
import { requireTripUser } from "../../_shared";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick") }),
  z.object({
    action: z.literal("respond"),
    response: z.enum(["ok", "need_more_time", "help"]),
    extensionMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]).optional(),
  }),
  z.object({
    action: z.literal("hint_feedback"),
    hintId: z.string().uuid(),
    helpful: z.boolean().nullable(),
    dismiss: z.boolean().default(false),
  }),
]);

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await context.params;
  const db = createAdminClient();
  const [{ data: trip, error: tripError }, { data: event, error: eventError }, { data: hints, error: hintsError }] = await Promise.all([
    db.from("trips").select("id,expected_arrival_at,intelligence_reason,intelligence_confidence,status")
      .eq("id", id).eq("owner_id", access.user.id).maybeSingle(),
    db.from("checkin_events").select("stage,reason,sent_at,responded_at,response,countdown_until,extension_minutes")
      .eq("trip_id", id).eq("user_id", access.user.id).maybeSingle(),
    db.from("safety_hints").select("id,hint_type,message,reason,severity,confidence,created_at,expires_at")
      .eq("user_id", access.user.id).eq("trip_id", id).is("dismissed_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(8),
  ]);
  if (tripError || eventError || hintsError) return NextResponse.json({ error: tripError?.message ?? eventError?.message ?? hintsError?.message }, { status: 500 });
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  return NextResponse.json({ trip, checkIn: event ?? null, hints: hints ?? [] });
}

export async function POST(request: Request, context: Context) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id } = await context.params;
  const input = parsed.data;
  const db = createAdminClient();
  const { data: allowed, error: limitError } = await db.rpc("consume_intelligence_limit", {
    p_user_id: access.user.id,
    p_action_key: input.action === "tick" ? "checkin_tick" : "checkin_action",
    p_limit: input.action === "tick" ? 6 : 6,
    p_window_seconds: 60,
  });
  if (limitError) return NextResponse.json({ error: limitError.message }, { status: 500 });
  if (!allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { data: trip, error: tripError } = await db.from("trips")
    .select("id,status,started_at,expected_arrival_at,last_check_in_at,intelligence_pattern_key,intelligence_reason,intelligence_confidence")
    .eq("id", id)
    .eq("owner_id", access.user.id)
    .in("status", ["active", "concern", "alert"])
    .maybeSingle();
  if (tripError) return NextResponse.json({ error: tripError.message }, { status: 500 });
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });

  if (input.action === "hint_feedback") {
    const { data, error } = await db.from("safety_hints").update({
      helpful: input.helpful,
      dismissed_at: input.dismiss ? new Date().toISOString() : null,
    }).eq("id", input.hintId).eq("trip_id", id).eq("user_id", access.user.id).select("id").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "hint_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (input.action === "respond") {
    const now = new Date();
    const { data: currentEvent, error: eventReadError } = await db.from("checkin_events")
      .select("id,stage,responded_at")
      .eq("trip_id", id)
      .eq("user_id", access.user.id)
      .maybeSingle();
    if (eventReadError) return NextResponse.json({ error: eventReadError.message }, { status: 500 });
    if (!currentEvent || currentEvent.responded_at) return NextResponse.json({ error: "There is no active check-in to answer." }, { status: 409 });

    if (input.response === "help") {
      const { error } = await db.from("checkin_events").update({
        stage: "resolved",
        response: "help",
        responded_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", currentEvent.id).is("responded_at", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const notificationIds = await createNotification({
        userId: access.user.id,
        type: "system",
        title: "Help requested",
        body: "Open Kiki to continue with your existing help options.",
        href: "/account",
        payload: { tripId: id, source: "trip_checkin" },
      }, db);
      if (!notificationIds.length) return NextResponse.json({ error: "The help notification could not be saved." }, { status: 500 });
      return NextResponse.json({ ok: true, next: "/account", message: "Your check-in is recorded. Open the SOS control on your account screen if you need emergency support." });
    }

    if (input.response === "need_more_time") {
      const minutes = input.extensionMinutes ?? 10;
      const currentArrival = new Date(trip.expected_arrival_at).getTime();
      const expectedArrival = new Date(applyCheckInExtension(currentArrival, minutes));
      const { error: tripUpdateError } = await db.from("trips").update({
        expected_arrival_at: expectedArrival.toISOString(),
        last_check_in_at: now.toISOString(),
        next_check_in_at: nextCheckInAt(now, expectedArrival).toISOString(),
        risk_score: 0,
        route_watch_state: "normal",
        status: "active",
      }).eq("id", id).eq("owner_id", access.user.id);
      if (tripUpdateError) return NextResponse.json({ error: tripUpdateError.message }, { status: 500 });
      const { error: eventUpdateError } = await db.from("checkin_events").update({
        stage: "due_soon",
        response: "need_more_time",
        responded_at: now.toISOString(),
        sent_at: now.toISOString(),
        countdown_until: null,
        extension_minutes: minutes,
        reason: { text: `The user asked for ${minutes} more minutes.` },
        updated_at: now.toISOString(),
      }).eq("id", currentEvent.id).is("responded_at", null);
      if (eventUpdateError) return NextResponse.json({ error: eventUpdateError.message }, { status: 500 });
      return NextResponse.json({ ok: true, expectedArrivalAt: expectedArrival.toISOString(), message: `We added ${minutes} minutes. You can check in again at any time.` });
    }

    const { error: eventUpdateError } = await db.from("checkin_events").update({
      stage: "resolved",
      response: "ok",
      responded_at: now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("id", currentEvent.id).is("responded_at", null);
    if (eventUpdateError) return NextResponse.json({ error: eventUpdateError.message }, { status: 500 });
    const { error: tripUpdateError } = await db.from("trips").update({
      last_check_in_at: now.toISOString(),
      risk_score: 0,
      route_watch_state: "normal",
      status: "active",
    }).eq("id", id).eq("owner_id", access.user.id);
    if (tripUpdateError) return NextResponse.json({ error: tripUpdateError.message }, { status: 500 });
    return NextResponse.json({ ok: true, message: "Thanks for checking in. Your trip remains active." });
  }

  const { data: settings, error: settingsError } = await db.from("user_intelligence_settings")
    .select("missed_checkin_enabled,guardian_notify_enabled,escalation_delay_minutes,quiet_hours")
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
  if (!settings?.missed_checkin_enabled) return NextResponse.json({ ok: true, stage: null, reason: "Smart check-ins are turned off." });

  const { data: currentEvent, error: eventReadError } = await db.from("checkin_events")
    .select("id,stage,reason,sent_at,responded_at,response,countdown_until")
    .eq("trip_id", id)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (eventReadError) return NextResponse.json({ error: eventReadError.message }, { status: 500 });

  let p95DurationSeconds: number | null = null;
  if (trip.intelligence_pattern_key) {
    const { data: pattern, error: patternError } = await db.from("trip_patterns").select("duration_p95")
      .eq("user_id", access.user.id)
      .eq("pattern_key", trip.intelligence_pattern_key)
      .maybeSingle();
    if (patternError) return NextResponse.json({ error: patternError.message }, { status: 500 });
    p95DurationSeconds = pattern?.duration_p95 ?? null;
  }

  const now = Date.now();
  const decision = nextCheckInStage({
    now,
    expectedArrivalAt: new Date(trip.expected_arrival_at).getTime(),
    p95DurationSeconds,
    startedAt: new Date(trip.started_at).getTime(),
    stage: currentEvent?.stage ?? null,
    sentAt: currentEvent?.sent_at ? new Date(currentEvent.sent_at).getTime() : null,
    countdownUntil: currentEvent?.countdown_until ? new Date(currentEvent.countdown_until).getTime() : null,
    response: currentEvent?.response ?? null,
    delayMinutes: settings.escalation_delay_minutes ?? 3,
    guardianNotifyEnabled: Boolean(settings.guardian_notify_enabled),
  });
  if (decision.action === "none" || decision.action === "resolve" || !decision.stage) {
    return NextResponse.json({ ok: true, stage: decision.stage, reason: decision.reason });
  }

  if (decision.stage === "due_soon" && currentEvent?.stage === "due_soon") {
    return NextResponse.json({ ok: true, stage: decision.stage, reason: decision.reason });
  }

  const nowIso = new Date(now).toISOString();
  const reason = {
    text: decision.reason,
    expectedArrivalAt: trip.expected_arrival_at,
    learnedReason: (trip.intelligence_reason as { text?: string } | null)?.text ?? "Using the route estimate.",
    confidence: (trip.intelligence_reason as { confidence?: number } | null)?.confidence ?? null,
    estimateConfidence: trip.intelligence_confidence,
  };
  const { error: eventWriteError } = await db.from("checkin_events").upsert({
    trip_id: id,
    user_id: access.user.id,
    stage: decision.stage,
    reason,
    sent_at: nowIso,
    responded_at: null,
    response: null,
    countdown_until: decision.countdownUntil,
    updated_at: nowIso,
  }, { onConflict: "trip_id" });
  if (eventWriteError) return NextResponse.json({ error: eventWriteError.message }, { status: 500 });

  const quietHours = isWithinQuietHours(new Date(now), settings.quiet_hours);
  if (!quietHours && (decision.action === "nudge" || decision.action === "countdown" || decision.action === "guardian_notice_unavailable")) {
    const body = decision.action === "guardian_notice_unavailable"
      ? "Open Kiki to continue your check-in."
      : decision.action === "nudge" ? "Please check in when you can." : "A check-in is waiting in Kiki.";
    const notificationIds = await createNotification({
      userId: access.user.id,
      type: "system",
      title: "Kiki",
      body,
      href: "/account/trips",
      payload: { tripId: id, action: decision.action },
    }, db);
    if (!notificationIds.length) return NextResponse.json({ error: "The check-in notification could not be saved." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    stage: decision.stage,
    action: decision.action,
    reason: decision.reason,
    countdownUntil: decision.countdownUntil,
    guardianDeliveryAvailable: false,
    notificationSuppressedByQuietHours: quietHours,
  });
}
