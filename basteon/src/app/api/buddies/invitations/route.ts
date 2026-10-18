import { NextResponse } from "next/server";
import { z } from "zod";
import { createMeetingCode } from "@/lib/buddies/meetingCode";
import { BUDDIES_REQUIRE_VERIFICATION } from "@/lib/verification/config";
import { requireFreshFaceProof } from "@/lib/verification/service";
import { safeJson, sameOrigin } from "@/lib/verification/http";
import { createNotifications } from "@/lib/notifications";
import { publicBuddyProfile } from "@/app/api/account/buddies/_shared";
import { recordBuddyAudit } from "../_audit";
import { activeBuddyTrip, requireBuddyUser } from "../_shared";

const sendSchema = z.object({ buddyId: z.string().uuid() });
const answerSchema = z.object({ invitationId: z.string().uuid(), action: z.enum(["accept", "decline"]) });
const INVITE_TTL_MS = 2 * 60 * 60_000;

export async function GET() {
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;

  const now = new Date().toISOString();
  const [{ data: incoming, error: incomingError }, { data: outgoing, error: outgoingError }] = await Promise.all([
    access.db.from("buddy_trip_invitations")
      .select("id,trip_id,inviter_id,created_at,expires_at")
      .eq("invited_user_id", access.user.id).eq("status", "pending").gt("expires_at", now)
      .order("created_at", { ascending: false }).limit(50),
    access.db.from("buddy_trip_invitations")
      .select("id,trip_id,invited_user_id,created_at,expires_at")
      .eq("inviter_id", access.user.id).eq("status", "pending").gt("expires_at", now)
      .order("created_at", { ascending: false }).limit(50),
  ]);
  if (incomingError || outgoingError) {
    console.error("Travel Together invitations could not be loaded", { incomingError, outgoingError });
    return safeJson({ error: "invitations_unavailable" }, { status: 500 });
  }

  const tripIds = [...new Set([...(incoming ?? []), ...(outgoing ?? [])].map((row) => row.trip_id as string))];
  const { data: trips, error: tripsError } = tripIds.length
    ? await access.db.from("buddy_trips").select("id,mode").in("id", tripIds)
    : { data: [], error: null };
  if (tripsError) {
    console.error("Travel Together invitation trip details could not be loaded", tripsError);
    return safeJson({ error: "invitations_unavailable" }, { status: 500 });
  }
  const tripModes = new Map((trips ?? []).map((trip) => [trip.id as string, trip.mode as string]));
  const incomingBuddies = await Promise.all((incoming ?? []).map((row) => publicBuddyProfile(access.db, row.inviter_id as string)));
  const outgoingBuddies = await Promise.all((outgoing ?? []).map((row) => publicBuddyProfile(access.db, row.invited_user_id as string)));

  return safeJson({
    incoming: (incoming ?? []).map((row, index) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      mode: tripModes.get(row.trip_id as string) ?? "walk",
      buddy: incomingBuddies[index],
    })),
    outgoing: (outgoing ?? []).map((row, index) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      mode: tripModes.get(row.trip_id as string) ?? "walk",
      buddy: outgoingBuddies[index],
    })),
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const input = sendSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return safeJson({ error: "invalid_invitation" }, { status: 400 });

  const buddyId = input.data.buddyId;
  const [{ data: outgoingContact, error: outgoingError }, { data: incomingContact, error: incomingError }, { data: blocks, error: blocksError }] = await Promise.all([
    access.db.from("buddy_contacts").select("contact_user_id").eq("user_id", access.user.id).eq("contact_user_id", buddyId).maybeSingle(),
    access.db.from("buddy_contacts").select("user_id").eq("user_id", buddyId).eq("contact_user_id", access.user.id).maybeSingle(),
    access.db.from("buddy_blocks").select("user_id").or(`and(user_id.eq.${access.user.id},blocked_user_id.eq.${buddyId}),and(user_id.eq.${buddyId},blocked_user_id.eq.${access.user.id})`).limit(1),
  ]);
  if (outgoingError || incomingError || blocksError) {
    console.error("Travel Together buddy eligibility check failed", { outgoingError, incomingError, blocksError });
    return safeJson({ error: "invitation_unavailable" }, { status: 500 });
  }
  if (!outgoingContact || !incomingContact || blocks?.length) return safeJson({ error: "not_buddies" }, { status: 403 });

  const trip = await activeBuddyTrip(access.db, access.user.id);
  if (!trip) return safeJson({ error: "no_active_trip" }, { status: 409 });

  const { data: previous, error: previousError } = await access.db.from("buddy_trip_invitations")
    .select("id,status,expires_at")
    .eq("trip_id", trip.id).eq("invited_user_id", buddyId).maybeSingle();
  if (previousError) {
    console.error("Travel Together invitation state could not be checked", previousError);
    return safeJson({ error: "invitation_unavailable" }, { status: 500 });
  }
  if (previous?.status === "accepted") return safeJson({ error: "already_joined" }, { status: 409 });
  if (previous?.status === "pending" && new Date(previous.expires_at).getTime() > Date.now()) {
    return safeJson({ error: "invitation_pending" }, { status: 409 });
  }

  const expiresAt = new Date(Math.min(Date.now() + INVITE_TTL_MS, new Date(trip.expires_at as string).getTime())).toISOString();
  let invitationId: string;
  if (previous) {
    const { data, error } = await access.db.from("buddy_trip_invitations")
      .update({ inviter_id: access.user.id, status: "pending", created_at: new Date().toISOString(), expires_at: expiresAt, responded_at: null })
      .eq("id", previous.id).in("status", ["pending", "declined", "cancelled", "expired"])
      .select("id").maybeSingle();
    if (error) {
      console.error("Travel Together invitation could not be renewed", error);
      return safeJson({ error: "invitation_unavailable" }, { status: 500 });
    }
    if (!data) return safeJson({ error: "invitation_pending" }, { status: 409 });
    invitationId = data.id;
  } else {
    const { data, error } = await access.db.from("buddy_trip_invitations")
      .insert({ trip_id: trip.id, inviter_id: access.user.id, invited_user_id: buddyId, expires_at: expiresAt })
      .select("id").single();
    if (error || !data) {
      if (error?.code === "23505") return safeJson({ error: "invitation_pending" }, { status: 409 });
      console.error("Travel Together invitation could not be created", error);
      return safeJson({ error: "invitation_unavailable" }, { status: 500 });
    }
    invitationId = data.id;
  }

  const inviter = await publicBuddyProfile(access.db, access.user.id);
  await createNotifications([{
    userId: buddyId,
    type: "walk_invite",
    title: "Travel Together invitation",
    body: `${inviter?.name ?? "A buddy"} invited you to join a walk or ride. Accept to share the group.`,
    href: "/account/trips?mode=travel-together",
    payload: { invitationId },
  }], access.db);
  return safeJson({ invitationId, status: "pending", expiresAt }, { status: previous ? 200 : 201 });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const input = answerSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return safeJson({ error: "invalid_response" }, { status: 400 });
  const accept = input.data.action === "accept";
  if (accept && BUDDIES_REQUIRE_VERIFICATION) {
    try {
      await requireFreshFaceProof(access.user.id);
    } catch {
      return safeJson({ error: "FACE_CHECK_REQUIRED" }, { status: 401 });
    }
  }

  const { data, error } = await access.db.rpc("respond_buddy_trip_invitation", {
    p_invitation_id: input.data.invitationId,
    p_user: access.user.id,
    p_accept: accept,
    p_meeting_code: createMeetingCode(),
  });
  if (error) {
    console.error("Travel Together invitation response failed", error);
    return safeJson({ error: "invitation_unavailable" }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { result?: string; bubble_id?: string | null } | null;
  if (!row?.result) return safeJson({ error: "invitation_unavailable" }, { status: 500 });
  if (row.result === "needs_trip") return safeJson({ error: "no_active_trip" }, { status: 409 });
  if (row.result === "not_found") return safeJson({ error: "invitation_not_found" }, { status: 404 });
  if (row.result === "expired" || row.result === "trip_expired") return safeJson({ error: "invitation_expired" }, { status: 410 });
  if (row.result === "not_buddies") return safeJson({ error: "not_buddies" }, { status: 403 });
  if (row.result !== "accepted" || !row.bubble_id) {
    return safeJson({ status: row.result });
  }

  const bubbleId = row.bubble_id;
  const trip = await activeBuddyTrip(access.db, access.user.id);
  if (trip) {
    await recordBuddyAudit(access.db, { tripId: trip.id, actorId: access.user.id, actorAlias: trip.alias as string, event: "member_joined" });
  }
  const { data: members, error: membersError } = await access.db.from("buddy_bubble_members")
    .select("user_id").eq("bubble_id", bubbleId).is("left_at", null);
  if (membersError) console.error("Travel Together bubble members could not be loaded", membersError);
  const memberIds = (members ?? []).map((member) => member.user_id as string);
  const notifications = [
    { userId: access.user.id, type: "buddy_bubble" as const, title: "You joined your buddy's travel group", body: "Your buddy accepted your Travel Together invitation. Open the group for its meeting details.", href: `/account/buddies/bubble/${bubbleId}`, payload: { bubbleId } },
    ...memberIds.filter((userId) => userId !== access.user.id).map((userId) => ({
      userId, type: "buddy_bubble" as const, title: "A buddy joined your travel group",
      body: "Your buddy accepted a Travel Together invitation. Open the group for its meeting details.",
      href: `/account/buddies/bubble/${bubbleId}`, payload: { bubbleId },
    })),
  ];
  await createNotifications(notifications, access.db);
  return safeJson({ status: "accepted", bubbleId });
}
