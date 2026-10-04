import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextCheckInAt } from "@/lib/hamba/checkIn";
import { remainingRouteDurationS } from "@/lib/hamba/geometry";
import type { PlannedRoute } from "@/lib/hamba/types";
import { requireTripUser } from "../../_shared";

const inputSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().nonnegative().optional(), speedMps: z.number().nonnegative().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_location" }, { status: 400 });
  const { id } = await params;
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("id,planned_route").eq("id", id).eq("owner_id", access.user.id).in("status", ["active", "concern", "alert"]).maybeSingle();
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  const { error } = await db.from("trip_locations").insert({ trip_id: id, lat: input.data.lat, lng: input.data.lng, accuracy_m: input.data.accuracyM, speed_mps: input.data.speedMps });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const now = new Date();
  const remainingS = remainingRouteDurationS({ ...input.data, timestamp: now.getTime() }, trip.planned_route as PlannedRoute);
  const expectedArrival = new Date(now.getTime() + remainingS * 1_000);
  const nextCheckIn = nextCheckInAt(now, expectedArrival);
  await db.from("trips").update({ last_heartbeat_at: now.toISOString(), expected_arrival_at: expectedArrival.toISOString(), next_check_in_at: nextCheckIn.toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true, expectedArrivalAt: expectedArrival.toISOString(), nextCheckInAt: nextCheckIn.toISOString() });
}