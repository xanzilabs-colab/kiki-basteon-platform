import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";

const settingsSchema = z.object({
  learningEnabled: z.boolean(),
  missedCheckinEnabled: z.boolean(),
  routeHintsEnabled: z.boolean(),
  shareHintsWithBuddies: z.boolean(),
  buddyHintsEnabled: z.boolean(),
  guardianNotifyEnabled: z.boolean(),
  hintNotificationsEnabled: z.boolean(),
  escalationDelayMinutes: z.number().int().min(1).max(30),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }),
  retentionDays: z.number().int().min(30).max(365),
});

const defaults = {
  learning_enabled: false,
  missed_checkin_enabled: false,
  route_hints_enabled: false,
  share_hints_with_buddies: false,
  buddy_hints_enabled: false,
  guardian_notify_enabled: false,
  hint_notifications_enabled: false,
  escalation_delay_minutes: 3,
  quiet_hours: { enabled: false, start: "22:00", end: "07:00" },
  retention_days: 90,
};

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await createAdminClient().from("user_intelligence_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const settings = data ?? defaults;
  return NextResponse.json({
    demoEnabled: process.env.KIKI_INTELLIGENCE_DEMO_ENABLED === "true",
    learningEnabled: settings.learning_enabled,
    missedCheckinEnabled: settings.missed_checkin_enabled,
    routeHintsEnabled: settings.route_hints_enabled,
    shareHintsWithBuddies: settings.share_hints_with_buddies,
    buddyHintsEnabled: settings.buddy_hints_enabled,
    guardianNotifyEnabled: settings.guardian_notify_enabled,
    hintNotificationsEnabled: settings.hint_notifications_enabled,
    escalationDelayMinutes: settings.escalation_delay_minutes,
    quietHours: settings.quiet_hours,
    retentionDays: settings.retention_days,
  });
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const { error } = await createAdminClient().from("user_intelligence_settings").upsert({
    user_id: userId,
    learning_enabled: input.learningEnabled,
    missed_checkin_enabled: input.missedCheckinEnabled,
    route_hints_enabled: input.routeHintsEnabled,
    share_hints_with_buddies: input.shareHintsWithBuddies,
    buddy_hints_enabled: input.buddyHintsEnabled,
    guardian_notify_enabled: input.guardianNotifyEnabled,
    hint_notifications_enabled: input.hintNotificationsEnabled,
    escalation_delay_minutes: input.escalationDelayMinutes,
    quiet_hours: input.quietHours,
    retention_days: input.retentionDays,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: trips, error: tripReadError } = await db.from("trips")
    .select("id")
    .eq("owner_id", userId);
  if (tripReadError) return NextResponse.json({ error: tripReadError.message }, { status: 500 });

  const tripIds = (trips ?? []).map((trip) => trip.id);
  if (tripIds.length) {
    const { error: intelligenceTripsError } = await db.from("trips").update({
      intelligence_pattern_key: null,
      intelligence_day_type: null,
      intelligence_time_bucket: null,
      intelligence_reason: {},
      intelligence_confidence: 0,
    }).eq("owner_id", userId);
    if (intelligenceTripsError) return NextResponse.json({ error: intelligenceTripsError.message }, { status: 500 });
  }

  const { data: patterns, error: patternReadError } = await db.from("trip_patterns")
    .select("sample_count")
    .eq("user_id", userId);
  if (patternReadError) return NextResponse.json({ error: patternReadError.message }, { status: 500 });
  const results = await Promise.all([
    db.from("trip_patterns").delete().eq("user_id", userId),
    db.from("checkin_events").delete().eq("user_id", userId),
    db.from("safety_hints").delete().eq("user_id", userId),
    db.from("intelligence_demo_sessions").delete().eq("user_id", userId),
    db.from("intelligence_rate_limits").delete().eq("user_id", userId),
  ]);
  const failure = results.find((result) => result.error)?.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    removedLearnedTripSamples: (patterns ?? []).reduce((total, pattern) => total + pattern.sample_count, 0),
    retainedTripHistory: true,
  });
}
