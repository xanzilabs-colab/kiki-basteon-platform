import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextCheckInAt } from "@/lib/hamba/checkIn";
import { blendExpectedDuration, buildTripPatternKey, getPatternTime } from "@/lib/intelligence/patterns";
import { requireTripUser } from "./_shared";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const tripSchema = z.object({
  destinationLabel: z.string().trim().min(1).max(240),
  destination: point,
  mode: z.enum(["taxi", "walk", "ehail", "bus", "train", "cycling"]),
  route: z.object({ points: z.array(point).min(2).max(5_000), distanceM: z.number().nonnegative(), durationS: z.number().nonnegative() }),
  checkpoints: z.array(point.extend({ label: z.string().max(80).optional(), expectedAt: z.string().datetime() })).max(6).default([]),
  tools: z.array(z.enum(["auto", "stops", "draw"])).max(3).default([]),
});

export async function GET() {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const db = createAdminClient();
  const [{ data, error }, { data: recent }] = await Promise.all([
    db.from("trips").select("*").eq("owner_id", access.user.id).in("status", ["planned", "active", "concern", "alert"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("trips").select("id,destination_label,destination_lat,destination_lng,mode,status,created_at,ended_at").eq("owner_id", access.user.id).in("status", ["arrived", "cancelled"]).order("created_at", { ascending: false }).limit(5),
  ]);
  const { data: checkpoints } = data ? await db.from("trip_checkpoints").select("id,lat,lng,label,expected_at,status").eq("trip_id", data.id).order("position") : { data: [] };
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ trip: data, recent: recent ?? [], checkpoints: checkpoints ?? [] });
}

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = tripSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const now = new Date();
  const db = createAdminClient();
  const { data: settings, error: settingsError } = await db.from("user_intelligence_settings")
    .select("learning_enabled")
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 });
  const learningEnabled = Boolean(settings?.learning_enabled);
  const origin = input.data.route.points[0];
  const patternKey = learningEnabled
    ? buildTripPatternKey(origin, input.data.destination)
    : null;
  const patternTime = getPatternTime(now);
  const { data: pattern, error: patternError } = patternKey
    ? await db.from("trip_patterns").select("sample_count,duration_p50,duration_p80")
      .eq("user_id", access.user.id)
      .eq("pattern_key", patternKey)
      .eq("mode", input.data.mode)
      .eq("day_type", patternTime.dayType)
      .eq("time_bucket", patternTime.timeBucket)
      .maybeSingle()
    : { data: null, error: null };
  if (patternError) return NextResponse.json({ error: patternError.message }, { status: 500 });
  const estimate = blendExpectedDuration(input.data.route.durationS, pattern ? {
    sampleCount: pattern.sample_count,
    durationP50: pattern.duration_p50,
    durationP80: pattern.duration_p80,
  } : null);
  const expectedArrival = new Date(now.getTime() + estimate.durationSeconds * 1_000);
  const { data, error } = await db.from("trips").insert({
    owner_id: access.user.id,
    destination_label: input.data.destinationLabel,
    destination_lat: input.data.destination.lat,
    destination_lng: input.data.destination.lng,
    mode: input.data.mode,
    status: "active",
    planned_route: input.data.route,
    route_distance_m: Math.round(input.data.route.distanceM),
    route_duration_s: Math.round(input.data.route.durationS),
    started_at: now.toISOString(),
    expected_arrival_at: expectedArrival.toISOString(),
    intelligence_pattern_key: patternKey,
    intelligence_day_type: patternKey ? patternTime.dayType : null,
    intelligence_time_bucket: patternKey ? patternTime.timeBucket : null,
    intelligence_reason: { text: estimate.reason, sampleCount: pattern?.sample_count ?? 0 },
    intelligence_confidence: estimate.confidence,
    last_heartbeat_at: now.toISOString(),
    last_check_in_at: now.toISOString(),
    next_check_in_at: nextCheckInAt(now, expectedArrival).toISOString(),
    consented_at: now.toISOString(),
    route_tools: input.data.tools,
    location_retention_until: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let checkpoints: unknown[] = [];
  if (input.data.checkpoints.length > 0) {
    const { data: inserted } = await db.from("trip_checkpoints").insert(input.data.checkpoints.map((cp, index) => ({ trip_id: data.id, position: index + 1, lat: cp.lat, lng: cp.lng, label: cp.label ?? `Stop ${index + 1}`, expected_at: cp.expectedAt }))).select("id,lat,lng,label,expected_at,status");
    checkpoints = inserted ?? [];
  }
  return NextResponse.json({ trip: data, checkpoints }, { status: 201 });
}