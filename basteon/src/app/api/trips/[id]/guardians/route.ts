import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotifications } from "@/lib/notifications";
import { publicBuddyProfile } from "@/app/api/account/buddies/_shared";
import { sameOrigin } from "@/lib/verification/http";
import { areCurrentBuddies } from "../../_guardians";
import { requireTripUser } from "../../_shared";

const inviteSchema = z.object({ guardianIds: z.array(z.string().uuid()).min(1).max(20).refine((ids) => new Set(ids).size === ids.length) });
const revokeSchema = z.object({ guardianId: z.string().uuid() });
const shareableTripStatuses = ["active", "concern", "alert"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const db = createAdminClient();
  const { data: trip, error: tripError } = await db.from("trips").select("id")
    .eq("id", id).eq("owner_id", access.user.id).in("status", [...shareableTripStatuses]).maybeSingle();
  if (tripError) {
    console.error("Trip guardian access check failed", tripError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  const { data: rows, error } = await db.from("trip_guardians")
    .select("id,guardian_id,status,created_at,updated_at,responded_at")
    .eq("trip_id", id).eq("owner_id", access.user.id).order("created_at", { ascending: true });
  if (error) {
    console.error("Trip guardians could not be loaded", error);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  const buddies = await Promise.all((rows ?? []).map((row) => publicBuddyProfile(db, row.guardian_id as string)));
  return NextResponse.json({
    guardians: (rows ?? []).map((row, index) => ({
      id: row.id,
      guardianId: row.guardian_id,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
      buddy: buddies[index],
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_guardians" }, { status: 400 });
  const { id } = await params;
  const db = createAdminClient();
  const { data: trip, error: tripError } = await db.from("trips").select("id,owner_id,status")
    .eq("id", id).eq("owner_id", access.user.id).in("status", [...shareableTripStatuses]).maybeSingle();
  if (tripError) {
    console.error("Trip guardian invitation trip lookup failed", tripError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  if (!trip) return NextResponse.json({ error: "trip_not_active" }, { status: 409 });

  const guardianIds = input.data.guardianIds;
  const [{ data: forward, error: forwardError }, { data: reverse, error: reverseError }, { data: blocksByOwner, error: blocksByOwnerError }, { data: blocksByBuddy, error: blocksByBuddyError }] = await Promise.all([
    db.from("buddy_contacts").select("contact_user_id").eq("user_id", access.user.id).in("contact_user_id", guardianIds),
    db.from("buddy_contacts").select("user_id").eq("contact_user_id", access.user.id).in("user_id", guardianIds),
    db.from("buddy_blocks").select("blocked_user_id").eq("user_id", access.user.id).in("blocked_user_id", guardianIds),
    db.from("buddy_blocks").select("user_id").eq("blocked_user_id", access.user.id).in("user_id", guardianIds),
  ]);
  if (forwardError || reverseError || blocksByOwnerError || blocksByBuddyError) {
    console.error("Trip guardian eligibility lookup failed", { forwardError, reverseError, blocksByOwnerError, blocksByBuddyError });
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  const mutual = new Set((forward ?? []).map((row) => row.contact_user_id as string));
  const reciprocal = new Set((reverse ?? []).map((row) => row.user_id as string));
  const blocked = new Set([
    ...(blocksByOwner ?? []).map((row) => row.blocked_user_id as string),
    ...(blocksByBuddy ?? []).map((row) => row.user_id as string),
  ]);
  if (guardianIds.some((guardianId) => !mutual.has(guardianId) || !reciprocal.has(guardianId) || blocked.has(guardianId))) {
    return NextResponse.json({ error: "guardian_must_be_an_unblocked_buddy" }, { status: 403 });
  }

  const { data: existingRows, error: existingError } = await db.from("trip_guardians")
    .select("guardian_id,status").eq("trip_id", id).eq("owner_id", access.user.id).in("guardian_id", guardianIds);
  if (existingError) {
    console.error("Trip guardian invitation state lookup failed", existingError);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  const existingByGuardian = new Map((existingRows ?? []).map((row) => [row.guardian_id as string, row.status as string]));
  const pendingIds: string[] = [];
  for (const guardianId of guardianIds) {
    const status = existingByGuardian.get(guardianId);
    if (status === "accepted" || status === "pending") continue;
    if (status) {
      const { data, error } = await db.from("trip_guardians")
        .update({ status: "pending", updated_at: new Date().toISOString(), responded_at: null })
        .eq("trip_id", id).eq("owner_id", access.user.id).eq("guardian_id", guardianId)
        .in("status", ["declined", "revoked"]).select("id").maybeSingle();
      if (error) {
        console.error("Trip guardian invitation could not be renewed", error);
        return NextResponse.json({ error: "guardian_shares_unavailable", sent: pendingIds }, { status: 500 });
      }
      if (data) pendingIds.push(guardianId);
      continue;
    }
    const { error } = await db.from("trip_guardians").insert({ trip_id: id, owner_id: access.user.id, guardian_id: guardianId });
    if (error) {
      if (error.code === "23505") continue;
      console.error("Trip guardian invitation could not be created", error);
      return NextResponse.json({ error: "guardian_shares_unavailable", sent: pendingIds }, { status: 500 });
    }
    pendingIds.push(guardianId);
  }

  const owner = await publicBuddyProfile(db, access.user.id);
  if (pendingIds.length) {
    await createNotifications(pendingIds.map((guardianId) => ({
      userId: guardianId,
      type: "walk_guardian" as const,
      title: "Walk guardian invitation",
      body: `${owner?.name ?? "A buddy"} invited you to be a guardian for their active walk. Accept to view their live route while the trip is active.`,
      href: "/account/guardian-walks",
      payload: { tripId: id },
    })), db);
  }
  return NextResponse.json({ pending: pendingIds, unchanged: guardianIds.filter((guardianId) => !pendingIds.includes(guardianId)) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_guardian" }, { status: 400 });
  const { id } = await params;
  const db = createAdminClient();
  const { data, error } = await db.from("trip_guardians")
    .update({ status: "revoked", updated_at: new Date().toISOString(), responded_at: new Date().toISOString() })
    .eq("trip_id", id).eq("owner_id", access.user.id).eq("guardian_id", input.data.guardianId)
    .in("status", ["pending", "accepted"]).select("id").maybeSingle();
  if (error) {
    console.error("Trip guardian access could not be revoked", error);
    return NextResponse.json({ error: "guardian_shares_unavailable" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "guardian_not_found" }, { status: 404 });
  await createNotifications([{
    userId: input.data.guardianId,
    type: "walk_guardian",
    title: "Walk sharing ended",
    body: "The trip owner stopped sharing this walk with you.",
    href: "/account/guardian-walks",
    payload: { tripId: id },
  }], db);
  return NextResponse.json({ revoked: true });
}
