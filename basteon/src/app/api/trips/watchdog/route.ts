import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";
import { createNotification } from "@/lib/notifications";
import { notifyGuardians } from "@/lib/hamba/guardianNotify";
import { checkpointConfig, deviationConfig, evaluateCheckpoint, isOffRoute, isOverdue } from "@/lib/hamba/checkpoints";

async function runWatchdog() {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: candidates, error } = await db.rpc("hamba_stale_trip_candidates", { p_before: cutoff });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all((candidates ?? []).map(async (candidate: { trip_id: string; owner_id: string }) => {
    await db.from("trips").update({ status: "concern", route_watch_state: "concern" }).eq("id", candidate.trip_id);
    await db.from("trip_events").insert({ trip_id: candidate.trip_id, event_type: "watchdog_heartbeat_gap", state: "concern", risk_score: 60, reasons: [{ signal: "heartbeat_gap", score: 60, reason: "Trip location updates stopped unexpectedly." }] });
    await sendPushNotificationsToUser(candidate.owner_id, { title: "Kiki", body: "Check in when you can.", tag: `hamba-watchdog-${candidate.trip_id}`, url: "/account/trips", tripId: candidate.trip_id, actions: [{ action: "check-in", title: "I'm OK" }] });
  }));
  await processMonitoring(db);
  return NextResponse.json({ checked: candidates?.length ?? 0 });
}

type Db = ReturnType<typeof createAdminClient>;

/**
 * Checkpoint prompts/reminders/escalation plus overdue and off-route detection.
 * Escalation raises the trip to "concern" and notifies the owner; it never creates an SOS.
 */
async function processMonitoring(db: Db) {
  const now = Date.now();
  const cfg = checkpointConfig();
  const dev = deviationConfig();
  const { data: trips } = await db.from("trips").select("id,owner_id,status,planned_route,expected_arrival_at").in("status", ["active", "concern"]).limit(500);
  for (const trip of trips ?? []) {
    const { data: cps } = await db.from("trip_checkpoints").select("id,label,expected_at,status,reminders_sent,last_notified_at").eq("trip_id", trip.id).not("expected_at", "is", null);
    for (const cp of cps ?? []) {
      const action = evaluateCheckpoint({ id: cp.id, expectedAt: new Date(cp.expected_at).getTime(), status: cp.status, remindersSent: cp.reminders_sent, lastNotifiedAt: cp.last_notified_at ? new Date(cp.last_notified_at).getTime() : null }, now, cfg);
      if (action === "none") continue;
      const label = cp.label ?? "your stop";
      if (action === "prompt") {
        await db.from("trip_checkpoints").update({ status: "prompted", last_notified_at: new Date(now).toISOString() }).eq("id", cp.id).eq("status", "pending");
        await createNotification({ userId: trip.owner_id, type: "trip_checkpoint", title: "Arriving at a stop", body: `Let us know when you reach ${label}.`, href: "/account/trips" });
      } else if (action === "reminder") {
        await db.from("trip_checkpoints").update({ status: "missed", reminders_sent: cp.reminders_sent + 1, last_notified_at: new Date(now).toISOString() }).eq("id", cp.id);
        await createNotification({ userId: trip.owner_id, type: "trip_checkpoint", title: "Check in when you can", body: `We haven't heard from you at ${label}. Tap to confirm you're OK.`, href: "/account/trips" });
      } else {
        await db.from("trip_checkpoints").update({ status: "escalated" }).eq("id", cp.id);
        await db.from("trips").update({ status: "concern", route_watch_state: "concern" }).eq("id", trip.id);
        await db.from("trip_events").insert({ trip_id: trip.id, event_type: "checkpoint_escalated", state: "concern", risk_score: 70, reasons: [{ signal: "missed_checkpoint", score: 70, reason: `No check-in at ${label} after ${cfg.maxReminders} reminders.` }] });
        await notifyGuardians(db, trip.owner_id, `no check-in at ${label}.`).catch(() => null);
      }
    }

    if (trip.status === "active" && trip.expected_arrival_at && isOverdue(new Date(trip.expected_arrival_at).getTime(), now, dev)) {
      await db.from("trips").update({ status: "concern", route_watch_state: "concern" }).eq("id", trip.id);
      await db.from("trip_events").insert({ trip_id: trip.id, event_type: "trip_overdue", state: "concern", risk_score: 55, reasons: [{ signal: "overdue", score: 55, reason: "Trip is past its expected arrival time." }] });
      await createNotification({ userId: trip.owner_id, type: "trip_checkpoint", title: "Trip running late", body: "Your trip is past its expected arrival. Check in when you can.", href: "/account/trips" });
            await notifyGuardians(db, trip.owner_id, "the trip is past its expected arrival.").catch(() => null);
            continue;
    }

    const route = (trip.planned_route as { points?: { lat: number; lng: number }[] } | null)?.points;
    if (trip.status === "active" && route && route.length > 1) {
      const { data: fixes } = await db.from("trip_locations").select("lat,lng,accuracy_m").eq("trip_id", trip.id).order("created_at", { ascending: false }).limit(dev.consecutiveFixes);
      const recent = (fixes ?? []).reverse().map((f) => ({ lat: f.lat, lng: f.lng, accuracyM: f.accuracy_m ?? undefined }));
      if (isOffRoute(recent, route, dev)) {
        await db.from("trips").update({ status: "concern", route_watch_state: "concern" }).eq("id", trip.id);
        await db.from("trip_events").insert({ trip_id: trip.id, event_type: "route_deviation", state: "concern", risk_score: 60, reasons: [{ signal: "off_route", score: 60, reason: `Last ${dev.consecutiveFixes} location updates were more than ${dev.offRouteM} m from the planned route.` }] });
        await createNotification({ userId: trip.owner_id, type: "trip_checkpoint", title: "Off your planned route", body: "You seem to be away from your route. Check in if you're OK.", href: "/account/trips" });
        await notifyGuardians(db, trip.owner_id, "they appear to be off their planned route.").catch(() => null);
      }
    }
  }
}

function cronAuthorized(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return Boolean(process.env.CRON_SECRET && bearer && bearer === process.env.CRON_SECRET);
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runWatchdog();
}

export async function POST(request: Request) {
  if (!process.env.TRIP_WATCHDOG_SECRET || request.headers.get("x-trip-watchdog-secret") !== process.env.TRIP_WATCHDOG_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runWatchdog();
}