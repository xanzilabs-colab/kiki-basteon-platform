import { NextResponse } from "next/server";
import { buddyAccount, publicBuddyProfile } from "../_shared";
import { areCurrentBuddies } from "@/app/api/trips/_guardians";
import { isFreshBuddyLocation, isInsidePrivacyZone, type PrivacyZone } from "@/lib/buddyLocation";

type Context = { params: Promise<{ userId: string }> };

function validUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, context: Context) {
  const account = await buddyAccount();
  if ("response" in account) return account.response;
  const { userId } = await context.params;
  if (!validUserId(userId) || userId === account.user.id) {
    return NextResponse.json({ error: "invalid_buddy" }, { status: 400 });
  }
  const relation = await areCurrentBuddies(account.db, account.user.id, userId);
  if (relation.error) {
    console.error("Buddy detail relationship check failed", relation.error);
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  if (!relation.allowed) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const buddy = await publicBuddyProfile(account.db, userId);
  if (!buddy) return NextResponse.json({ error: "buddy_not_found" }, { status: 404 });

  const [{ data: shares, error: sharesError }, { data: settings, error: settingsError }] = await Promise.all([
    account.db.from("buddy_location_shares").select("owner_id,enabled")
      .or(`and(owner_id.eq.${userId},viewer_id.eq.${account.user.id}),and(owner_id.eq.${account.user.id},viewer_id.eq.${userId})`),
    account.db.from("user_privacy_settings").select("user_id,live_location_sharing")
      .in("user_id", [account.user.id, userId]),
  ]);
  if (sharesError || settingsError) {
    console.error("Buddy location-sharing settings could not be loaded", { sharesError, settingsError });
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  const sharing = {
    theyShareWithMe: Boolean(shares?.some((share) => share.owner_id === userId && share.enabled)),
    iShareWithThem: Boolean(shares?.some((share) => share.owner_id === account.user.id && share.enabled)),
    theyHaveLiveLocationEnabled: Boolean(settings?.some((setting) => setting.user_id === userId && setting.live_location_sharing)),
  };

  let location: { lat: number; lng: number; recordedAt: string } | null = null;
  if (sharing.theyShareWithMe && sharing.theyHaveLiveLocationEnabled) {
    const [{ data: latest, error: locationError }, { data: zones, error: zonesError }] = await Promise.all([
      account.db.from("buddy_live_locations").select("lat,lng,recorded_at").eq("user_id", userId).maybeSingle(),
      account.db.from("buddy_privacy_zones").select("lat,lng,radius_m").eq("user_id", userId),
    ]);
    if (locationError || zonesError) {
      console.error("Buddy live location could not be loaded", { locationError, zonesError });
      return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
    }
    const zonesForBuddy = (zones ?? []).map((zone) => ({
      lat: zone.lat as number,
      lng: zone.lng as number,
      radius_m: zone.radius_m as number,
    })) satisfies PrivacyZone[];
    if (latest && isFreshBuddyLocation(latest.recorded_at as string)
      && !isInsidePrivacyZone({ lat: latest.lat as number, lng: latest.lng as number }, zonesForBuddy)) {
      location = { lat: latest.lat as number, lng: latest.lng as number, recordedAt: latest.recorded_at as string };
    } else if (latest) {
      const { error } = await account.db.from("buddy_live_locations").delete().eq("user_id", userId);
      if (error) {
        console.error("Expired or privacy-suppressed buddy location could not be cleared", error);
        return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
      }
    }
  }

  const { data: guardians, error: guardiansError } = await account.db.from("trip_guardians")
    .select("trip_id,owner_id,status,created_at")
    .or(`and(owner_id.eq.${account.user.id},guardian_id.eq.${userId}),and(owner_id.eq.${userId},guardian_id.eq.${account.user.id})`)
    .in("status", ["accepted", "revoked"])
    .order("created_at", { ascending: false }).limit(50);
  if (guardiansError) {
    console.error("Shared buddy trip history could not be loaded", guardiansError);
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  const guardianTripIds = [...new Set((guardians ?? []).map((row) => row.trip_id as string))];
  const { data: guardianTrips, error: tripError } = guardianTripIds.length
    ? await account.db.from("trips").select("id,destination_label,mode,status,started_at,ended_at,created_at").in("id", guardianTripIds)
    : { data: [], error: null };
  if (tripError) {
    console.error("Shared buddy trip details could not be loaded", tripError);
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  const guardianTripById = new Map((guardianTrips ?? []).map((trip) => [trip.id as string, trip]));
  const history = (guardians ?? []).flatMap((share) => {
    const trip = guardianTripById.get(share.trip_id as string);
    if (!trip) return [];
    return [{
      id: trip.id,
      destination: trip.destination_label,
      mode: trip.mode,
      status: trip.status,
      startedAt: trip.started_at,
      endedAt: trip.ended_at,
      relation: share.owner_id === account.user.id ? "You shared your route" : "You watched their route",
      createdAt: trip.created_at,
    }];
  });

  const { data: bubbleMemberships, error: membershipsError } = await account.db.from("buddy_bubble_members")
    .select("bubble_id,user_id,trip_id,created_at")
    .in("user_id", [account.user.id, userId])
    .not("trip_id", "is", null)
    .order("created_at", { ascending: false }).limit(200);
  if (membershipsError) {
    console.error("Travel Together history could not be loaded", membershipsError);
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  const membersByBubble = new Map<string, NonNullable<typeof bubbleMemberships>>();
  for (const member of bubbleMemberships ?? []) {
    membersByBubble.set(member.bubble_id as string, [...(membersByBubble.get(member.bubble_id as string) ?? []), member]);
  }
  const sharedBubbles = [...membersByBubble.entries()].filter(([, members]) =>
    members.some((member) => member.user_id === account.user.id)
    && members.some((member) => member.user_id === userId),
  );
  const sharedBubbleMembers = sharedBubbles.flatMap(([, members]) => members);
  const bubbleTripIds = [...new Set(sharedBubbleMembers.map((member) => member.trip_id as string))];
  const { data: bubbleTrips, error: bubbleTripsError } = bubbleTripIds.length
    ? await account.db.from("buddy_trips").select("id,alias,mode,active,created_at,expires_at").in("id", bubbleTripIds)
    : { data: [], error: null };
  if (bubbleTripsError) {
    console.error("Travel Together trip history could not be loaded", bubbleTripsError);
    return NextResponse.json({ error: "buddy_details_unavailable" }, { status: 503 });
  }
  const bubbleTripById = new Map((bubbleTrips ?? []).map((trip) => [trip.id as string, trip]));
  for (const [bubbleId, members] of sharedBubbles) {
    const sharedTrips = members.flatMap((member) => {
      const trip = bubbleTripById.get(member.trip_id as string);
      return trip ? [trip] : [];
    });
    if (!sharedTrips.length) continue;
    const createdAt = sharedTrips
      .map((trip) => trip.created_at as string)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const active = sharedTrips.some((trip) => trip.active);
    history.push({
      id: bubbleId,
      destination: [...new Set(sharedTrips.map((trip) => trip.alias as string).filter(Boolean))].join(" · ") || "Shared buddy walk",
      mode: sharedTrips[0].mode as string,
      status: active ? "active" : "completed",
      startedAt: createdAt,
      endedAt: active ? null : sharedTrips.map((trip) => trip.expires_at as string).sort((a, b) => Date.parse(b) - Date.parse(a))[0],
      relation: "Travel Together",
      createdAt,
    });
  }
  history.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return NextResponse.json({
    buddy,
    sharing,
    location,
    trips: history.slice(0, 50),
  }, { headers: { "Cache-Control": "no-store" } });
}

async function relationshipAction(request: Request, context: Context, action: "remove" | "block" | "unblock") {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;
  const { userId } = await context.params;
  if (!validUserId(userId) || userId === account.user.id) {
    return NextResponse.json({ error: "invalid_buddy" }, { status: 400 });
  }

  const rpc = {
    remove: "remove_buddy_connection",
    block: "block_buddy_connection",
    unblock: "unblock_buddy_connection",
  }[action];
  const { data, error } = await account.db.rpc(rpc, {
    p_user: account.user.id,
    p_other: userId,
  });
  if (error) {
    console.error(`Buddy ${action} failed`, error);
    return NextResponse.json({ error: "buddy_action_unavailable" }, { status: 500 });
  }
  const result = typeof data === "string" ? data : Array.isArray(data) ? data[0] : data;
  const expectedResult = action === "remove" ? "removed" : action === "block" ? "blocked" : "unblocked";
  if (result === expectedResult) {
    return NextResponse.json({ result });
  }
  const statusCodes: Record<string, number> = {
    not_connected: 404,
    not_blocked: 404,
    not_found: 404,
    invalid_target: 400,
  };
  return NextResponse.json({ error: result ?? "buddy_action_unavailable" }, { status: statusCodes[String(result)] ?? 500 });
}

export async function DELETE(request: Request, context: Context) {
  return relationshipAction(request, context, "remove");
}

export async function POST(request: Request, context: Context) {
  return relationshipAction(request, context, "block");
}

export async function PATCH(request: Request, context: Context) {
  return relationshipAction(request, context, "unblock");
}
