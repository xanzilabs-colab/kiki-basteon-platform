import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextCheckInAt } from "@/lib/hamba/checkIn";
import { requireTripUser } from "./_shared";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const tripSchema = z.object({
  destinationLabel: z.string().trim().min(1).max(240),
  destination: point,
  mode: z.enum(["taxi", "walk"]),
  route: z.object({ points: z.array(point).min(2).max(5_000), distanceM: z.number().nonnegative(), durationS: z.number().nonnegative() }),
});

export async function GET() {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const db = createAdminClient();
  const [{ data, error }, { data: recent }] = await Promise.all([
    db.from("trips").select("*").eq("owner_id", access.user.id).in("status", ["planned", "active", "concern", "alert"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("trips").select("id,destination_label,destination_lat,destination_lng,mode,status,created_at,ended_at").eq("owner_id", access.user.id).in("status", ["arrived", "cancelled"]).order("created_at", { ascending: false }).limit(5),
  ]);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ trip: data, recent: recent ?? [] });
}

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = tripSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const now = new Date();
  const expectedArrival = new Date(now.getTime() + input.data.route.durationS * 1_000);
  const { data, error } = await createAdminClient().from("trips").insert({
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
    last_heartbeat_at: now.toISOString(),
    last_check_in_at: now.toISOString(),
    next_check_in_at: nextCheckInAt(now, expectedArrival).toISOString(),
    consented_at: now.toISOString(),
    location_retention_until: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trip: data }, { status: 201 });
}