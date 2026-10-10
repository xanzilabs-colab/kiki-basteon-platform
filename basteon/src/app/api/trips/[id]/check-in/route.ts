import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextCheckInAt } from "@/lib/hamba/checkIn";
import { requireTripUser } from "../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const now = new Date();
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("expected_arrival_at").eq("id", id).eq("owner_id", access.user.id).in("status", ["active", "concern", "alert"]).maybeSingle();
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { checkpointId?: unknown };
  if (typeof body.checkpointId === "string") {
    await db.from("trip_checkpoints").update({ status: "checked_in", checked_in_at: now.toISOString() }).eq("id", body.checkpointId).eq("trip_id", id).in("status", ["pending", "prompted", "missed"]);
  }
  const { error } = await db.from("trips").update({ last_check_in_at: now.toISOString(), next_check_in_at: nextCheckInAt(now, new Date(trip.expected_arrival_at)).toISOString(), risk_score: 0, route_watch_state: "normal" }).eq("id", id).eq("owner_id", access.user.id);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}