import { NextResponse } from "next/server";
import { buildPatternStats } from "@/lib/intelligence/patterns";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripUser } from "../../_shared";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const db = createAdminClient();
  const { data: trip, error: readError } = await db.from("trips")
    .select("id,status,started_at,ended_at,mode,intelligence_pattern_key,intelligence_day_type,intelligence_time_bucket")
    .eq("id", id)
    .eq("owner_id", access.user.id)
    .in("status", ["active", "concern", "alert", "arrived"])
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  const endedAt = trip.ended_at ?? new Date().toISOString();
  if (trip.status !== "arrived") {
    const { error: updateError } = await db.from("trips")
      .update({ status: "arrived", ended_at: endedAt })
      .eq("id", id)
      .eq("owner_id", access.user.id)
      .in("status", ["active", "concern", "alert"]);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (trip.intelligence_pattern_key) {
    const { data: settings, error: settingsError } = await db.from("user_intelligence_settings")
      .select("learning_enabled")
      .eq("user_id", access.user.id)
      .maybeSingle();
    if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
    if (settings?.learning_enabled) {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
      const { data: completed, error: completedError } = await db.from("trips")
        .select("started_at,ended_at")
        .eq("owner_id", access.user.id)
        .eq("intelligence_pattern_key", trip.intelligence_pattern_key)
        .eq("mode", trip.mode)
        .eq("intelligence_day_type", trip.intelligence_day_type)
        .eq("intelligence_time_bucket", trip.intelligence_time_bucket)
        .eq("status", "arrived")
        .gte("ended_at", since)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false })
        .limit(30);
      if (completedError) return NextResponse.json({ error: completedError.message }, { status: 500 });
      const stats = buildPatternStats((completed ?? []).flatMap((sample) => {
        if (!sample.started_at || !sample.ended_at) return [];
        const durationSeconds = (new Date(sample.ended_at).getTime() - new Date(sample.started_at).getTime()) / 1_000;
        return durationSeconds >= 0 ? [{ durationSeconds, completedAt: sample.ended_at }] : [];
      }));
      if (stats) {
        const { error: patternError } = await db.from("trip_patterns").upsert({
          user_id: access.user.id,
          pattern_key: trip.intelligence_pattern_key,
          mode: trip.mode,
          day_type: trip.intelligence_day_type,
          time_bucket: trip.intelligence_time_bucket,
          sample_count: stats.sampleCount,
          duration_p50: stats.durationP50,
          duration_p80: stats.durationP80,
          duration_p95: stats.durationP95,
          arrival_window_start: stats.arrivalWindowStart,
          arrival_window_end: stats.arrivalWindowEnd,
          durations_seconds: stats.durationsSeconds,
          last_updated: new Date().toISOString(),
        }, { onConflict: "user_id,pattern_key,mode,day_type,time_bucket" });
        if (patternError) return NextResponse.json({ error: patternError.message }, { status: 500 });
      }
    }
  }
  return NextResponse.json({ ok: true });
}