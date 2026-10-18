import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { publicBuddyProfile } from "@/app/api/account/buddies/_shared";
import { sameOrigin } from "@/lib/verification/http";
import { areCurrentBuddies } from "../../_guardians";
import { requireTripUser } from "../../_shared";

const liveStatuses = ["active", "concern", "alert"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const db = createAdminClient();
  const { data: share, error: shareError } = await db.from("trip_guardians")
    .select("id,owner_id,status").eq("trip_id", id).eq("guardian_id", access.user.id).maybeSingle();
  if (shareError) {
    console.error("Guardian trip access lookup failed", shareError);
    return NextResponse.json({ error: "trip_unavailable" }, { status: 500 });
  }
  if (!share || share.status !== "accepted") return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  const relation = await areCurrentBuddies(db, access.user.id, share.owner_id as string);
  if (relation.error) {
    console.error("Guardian trip buddy relationship check failed", relation.error);
    return NextResponse.json({ error: "trip_unavailable" }, { status: 500 });
  }
  if (!relation.allowed) {
    await db.from("trip_guardians").update({ status: "revoked", updated_at: new Date().toISOString(), responded_at: new Date().toISOString() })
      .eq("trip_id", id).eq("guardian_id", access.user.id).eq("status", "accepted");
    return NextResponse.json({ error: "sharing_revoked" }, { status: 403 });
  }

  const { data: trip, error: tripError } = await db.from("trips")
    .select("id,owner_id,status,destination_label,mode,planned_route,started_at,expected_arrival_at,next_check_in_at,route_watch_state,risk_score")
    .eq("id", id).eq("owner_id", share.owner_id).maybeSingle();
  if (tripError) {
    console.error("Guardian trip could not be loaded", tripError);
    return NextResponse.json({ error: "trip_unavailable" }, { status: 500 });
  }
  if (!trip) return NextResponse.json({ error: "trip_ended" }, { status: 410 });
  if (!liveStatuses.includes(trip.status as typeof liveStatuses[number])) {
    return NextResponse.json({ error: "trip_ended" }, { status: 410 });
  }

  const [{ data: location, error: locationError }, { data: missed, error: checkpointError }, { data: event, error: eventError }] = await Promise.all([
    db.from("trip_locations").select("lat,lng,accuracy_m,recorded_at").eq("trip_id", id).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("trip_checkpoints").select("label,expected_at,status,lat,lng").eq("trip_id", id).in("status", ["missed", "escalated"]).order("expected_at", { ascending: true }).limit(20),
    db.from("trip_events").select("event_type,state,reasons,created_at").eq("trip_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (locationError || checkpointError || eventError) {
    console.error("Guardian trip safety details could not be loaded", { locationError, checkpointError, eventError });
    return NextResponse.json({ error: "trip_unavailable" }, { status: 500 });
  }
  const buddy = await publicBuddyProfile(db, share.owner_id as string);
  return NextResponse.json({
    trip: {
      id: trip.id,
      status: trip.status,
      destinationLabel: trip.destination_label,
      mode: trip.mode,
      plannedRoute: trip.planned_route,
      startedAt: trip.started_at,
      expectedArrivalAt: trip.expected_arrival_at,
      nextCheckInAt: trip.next_check_in_at,
      routeWatchState: trip.route_watch_state,
      riskScore: trip.risk_score,
      latestEvent: event ?? null,
      missedCheckIns: missed ?? [],
      latestLocation: location ?? null,
      owner: buddy,
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const db = createAdminClient();
  const { data: share, error } = await db.from("trip_guardians")
    .update({ status: "revoked", updated_at: new Date().toISOString(), responded_at: new Date().toISOString() })
    .eq("trip_id", id).eq("guardian_id", access.user.id).eq("status", "accepted")
    .select("owner_id").maybeSingle();
  if (error) {
    console.error("Guardian stopped viewing the trip but sharing state could not be updated", error);
    return NextResponse.json({ error: "sharing_unavailable" }, { status: 500 });
  }
  if (!share) return NextResponse.json({ error: "sharing_not_found" }, { status: 404 });
  await createNotifications([{
    userId: share.owner_id as string,
    type: "walk_guardian",
    title: "Walk guardian access ended",
    body: "Your buddy stopped viewing your shared walk.",
    href: "/account/trips",
    payload: { tripId: id },
  }], db);
  return NextResponse.json({ revoked: true });
}
