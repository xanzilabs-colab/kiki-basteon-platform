import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";

export async function POST(request: Request) {
  if (!process.env.TRIP_WATCHDOG_SECRET || request.headers.get("x-trip-watchdog-secret") !== process.env.TRIP_WATCHDOG_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: candidates, error } = await db.rpc("hamba_stale_trip_candidates", { p_before: cutoff });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all((candidates ?? []).map(async (candidate: { trip_id: string; owner_id: string }) => {
    await db.from("trips").update({ status: "concern", route_watch_state: "concern" }).eq("id", candidate.trip_id);
    await db.from("trip_events").insert({ trip_id: candidate.trip_id, event_type: "watchdog_heartbeat_gap", state: "concern", risk_score: 60, reasons: [{ signal: "heartbeat_gap", score: 60, reason: "Trip location updates stopped unexpectedly." }] });
    await sendPushNotificationsToUser(candidate.owner_id, { title: "Kiki", body: "Check in when you can.", tag: `hamba-watchdog-${candidate.trip_id}`, url: "/account/trips", tripId: candidate.trip_id, actions: [{ action: "check-in", title: "I'm OK" }] });
  }));
  return NextResponse.json({ checked: candidates?.length ?? 0 });
}