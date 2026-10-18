import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { publicBuddyProfile } from "@/app/api/account/buddies/_shared";
import { sameOrigin } from "@/lib/verification/http";
import { areCurrentBuddies } from "../_guardians";
import { requireTripUser } from "../_shared";

const answerSchema = z.object({ invitationId: z.string().uuid(), action: z.enum(["accept", "decline"]) });
const liveStatuses = ["active", "concern", "alert"] as const;

export async function GET() {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const db = createAdminClient();
  const { data: rows, error } = await db.from("trip_guardians")
    .select("id,trip_id,owner_id,status,created_at,responded_at")
    .eq("guardian_id", access.user.id).in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error("Guardian walk invitations could not be loaded", error);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  const ownerIds = [...new Set((rows ?? []).map((row) => row.owner_id as string))];
  const tripIds = [...new Set((rows ?? []).map((row) => row.trip_id as string))];
  const owners = await Promise.all(ownerIds.map((id) => publicBuddyProfile(db, id)));
  const ownerById = new Map(owners.filter((buddy) => buddy !== null).map((buddy) => [buddy.id, buddy]));
  const { data: trips, error: tripsError } = tripIds.length
    ? await db.from("trips").select("id,status,mode").in("id", tripIds)
    : { data: [], error: null };
  if (tripsError) {
    console.error("Guardian walk trip status could not be loaded", tripsError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  const tripById = new Map((trips ?? []).map((trip) => [trip.id as string, trip]));
  return NextResponse.json({
    invitations: (rows ?? []).map((row) => {
      const trip = tripById.get(row.trip_id as string);
      return {
        id: row.id,
        tripId: row.trip_id,
        status: row.status,
        createdAt: row.created_at,
        respondedAt: row.responded_at,
        active: Boolean(trip && liveStatuses.includes(trip.status as typeof liveStatuses[number])),
        mode: trip?.mode ?? null,
        buddy: ownerById.get(row.owner_id as string) ?? null,
      };
    }),
  });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = answerSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_response" }, { status: 400 });
  const db = createAdminClient();
  const { data: invite, error: inviteError } = await db.from("trip_guardians")
    .select("id,trip_id,owner_id,status").eq("id", input.data.invitationId)
    .eq("guardian_id", access.user.id).maybeSingle();
  if (inviteError) {
    console.error("Guardian walk invitation lookup failed", inviteError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  if (!invite || invite.status !== "pending") return NextResponse.json({ error: "invitation_not_found" }, { status: 404 });
  if (input.data.action === "accept") {
    const relation = await areCurrentBuddies(db, access.user.id, invite.owner_id as string);
    if (relation.error) {
      console.error("Guardian buddy relationship check failed", relation.error);
      return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
    }
    if (!relation.allowed) return NextResponse.json({ error: "not_buddies" }, { status: 403 });
    const { data: trip, error: tripError } = await db.from("trips").select("id,status")
      .eq("id", invite.trip_id).eq("owner_id", invite.owner_id).in("status", [...liveStatuses]).maybeSingle();
    if (tripError) {
      console.error("Guardian walk trip validation failed", tripError);
      return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
    }
    if (!trip) return NextResponse.json({ error: "trip_ended" }, { status: 410 });
  }
  const status = input.data.action === "accept" ? "accepted" : "declined";
  const { data: updated, error: updateError } = await db.from("trip_guardians")
    .update({ status, updated_at: new Date().toISOString(), responded_at: new Date().toISOString() })
    .eq("id", invite.id).eq("guardian_id", access.user.id).eq("status", "pending")
    .select("id").maybeSingle();
  if (updateError) {
    console.error("Guardian walk invitation response failed", updateError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "invitation_already_answered" }, { status: 409 });
  if (status === "accepted") {
    await createNotifications([{
      userId: invite.owner_id as string,
      type: "walk_guardian",
      title: "Walk guardian accepted",
      body: "Your buddy accepted. They can see your live route only while this trip is active.",
      href: "/account/trips",
      payload: { tripId: invite.trip_id as string },
    }], db);
  }
  return NextResponse.json({ status, tripId: invite.trip_id });
}
