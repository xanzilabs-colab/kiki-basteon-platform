import { NextResponse } from "next/server";
import { z } from "zod";
import { buddyAccount, publicBuddyProfile } from "../_shared";
import { isFreshBuddyLocation, isInsidePrivacyZone, type PrivacyZone } from "@/lib/buddyLocation";
import { areCurrentBuddies } from "@/app/api/trips/_guardians";

export const dynamic = "force-dynamic";

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
}).strict();

export async function GET() {
  const account = await buddyAccount();
  if ("response" in account) return account.response;

  const [{ data: incoming, error: incomingError }, { data: outgoing, error: outgoingError }, { data: privacy, error: privacyError }] = await Promise.all([
    account.db.from("buddy_location_shares").select("owner_id").eq("viewer_id", account.user.id).eq("enabled", true),
    account.db.from("buddy_location_shares").select("viewer_id").eq("owner_id", account.user.id).eq("enabled", true),
    account.db.from("user_privacy_settings").select("live_location_sharing").eq("user_id", account.user.id).maybeSingle(),
  ]);
  if (incomingError || outgoingError || privacyError) {
    console.error("Buddy map access could not be loaded", { incomingError, outgoingError, privacyError });
    return NextResponse.json({ error: "buddy_locations_unavailable" }, { status: 503 });
  }

  const outgoingIds = [...new Set((outgoing ?? []).map((row) => row.viewer_id as string))];
  const outgoingChecks = await Promise.all(outgoingIds.map((id) => areCurrentBuddies(account.db, account.user.id, id)));
  if (outgoingChecks.some((check) => check.error)) {
    console.error("Buddy map relationship checks failed", outgoingChecks.map((check) => check.error).filter(Boolean));
    return NextResponse.json({ error: "buddy_locations_unavailable" }, { status: 503 });
  }
  const canShareMyLocation = Boolean(privacy?.live_location_sharing)
    && outgoingChecks.some((check) => check.allowed);

  const candidateIds = [...new Set((incoming ?? []).map((row) => row.owner_id as string))];
  const relationships = await Promise.all(candidateIds.map((id) => areCurrentBuddies(account.db, account.user.id, id)));
  if (relationships.some((check) => check.error)) {
    console.error("Buddy map relationship checks failed", relationships.map((check) => check.error).filter(Boolean));
    return NextResponse.json({ error: "buddy_locations_unavailable" }, { status: 503 });
  }
  const allowedIds = candidateIds.filter((_, index) => relationships[index].allowed);
  if (!allowedIds.length) {
    return NextResponse.json({ locations: [], canShareMyLocation }, { headers: { "Cache-Control": "no-store" } });
  }

  const [{ data: locations, error: locationsError }, { data: ownerSettings, error: ownerSettingsError }, { data: zones, error: zonesError }] = await Promise.all([
    account.db.from("buddy_live_locations").select("user_id,lat,lng,accuracy_m,recorded_at").in("user_id", allowedIds),
    account.db.from("user_privacy_settings").select("user_id,live_location_sharing").in("user_id", allowedIds),
    account.db.from("buddy_privacy_zones").select("user_id,lat,lng,radius_m").in("user_id", allowedIds),
  ]);
  if (locationsError || ownerSettingsError || zonesError) {
    console.error("Buddy map locations could not be loaded", { locationsError, ownerSettingsError, zonesError });
    return NextResponse.json({ error: "buddy_locations_unavailable" }, { status: 503 });
  }

  const enabledUsers = new Set((ownerSettings ?? []).filter((row) => row.live_location_sharing).map((row) => row.user_id as string));
  const zonesByUser = new Map<string, PrivacyZone[]>();
  for (const zone of zones ?? []) {
    const list = zonesByUser.get(zone.user_id as string) ?? [];
    list.push({ lat: zone.lat as number, lng: zone.lng as number, radius_m: zone.radius_m as number });
    zonesByUser.set(zone.user_id as string, list);
  }
  const isSuppressed = (location: NonNullable<typeof locations>[number]) =>
    !enabledUsers.has(location.user_id as string)
    || isInsidePrivacyZone(
      { lat: location.lat as number, lng: location.lng as number },
      zonesByUser.get(location.user_id as string) ?? [],
    );
  const freshLocations = (locations ?? []).filter((location) =>
    !isSuppressed(location) && isFreshBuddyLocation(location.recorded_at as string),
  );
  const expiredOrSuppressedIds = (locations ?? [])
    .filter((location) => !isFreshBuddyLocation(location.recorded_at as string) || isSuppressed(location))
    .map((location) => location.user_id as string);
  if (expiredOrSuppressedIds.length) {
    const { error } = await account.db.from("buddy_live_locations").delete().in("user_id", expiredOrSuppressedIds);
    if (error) {
      console.error("Expired or privacy-suppressed buddy locations could not be cleared", error);
      return NextResponse.json({ error: "buddy_locations_unavailable" }, { status: 503 });
    }
  }

  const profiles = await Promise.all(freshLocations.map((location) => publicBuddyProfile(account.db, location.user_id as string)));
  return NextResponse.json({
    canShareMyLocation,
    locations: freshLocations.flatMap((location, index) => {
      const buddy = profiles[index];
      if (!buddy) return [];
      return [{
        ...buddy,
        lat: location.lat,
        lng: location.lng,
        recordedAt: location.recorded_at,
      }];
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;
  const input = locationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_location" }, { status: 400 });

  const [{ data: privacy, error: privacyError }, { data: shares, error: sharesError }] = await Promise.all([
    account.db.from("user_privacy_settings").select("live_location_sharing").eq("user_id", account.user.id).maybeSingle(),
    account.db.from("buddy_location_shares").select("viewer_id").eq("owner_id", account.user.id).eq("enabled", true),
  ]);
  if (privacyError || sharesError) {
    console.error("Buddy location sharing permission could not be checked", { privacyError, sharesError });
    return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
  }
  const viewerIds = [...new Set((shares ?? []).map((share) => share.viewer_id as string))];
  const relationships = await Promise.all(viewerIds.map((id) => areCurrentBuddies(account.db, account.user.id, id)));
  if (relationships.some((check) => check.error)) {
    console.error("Buddy location sharing relationship checks failed", relationships.map((check) => check.error).filter(Boolean));
    return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
  }
  if (!privacy?.live_location_sharing || !relationships.some((check) => check.allowed)) {
    const { error } = await account.db.from("buddy_live_locations").delete().eq("user_id", account.user.id);
    if (error) {
      console.error("Unshared buddy location could not be cleared", error);
      return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ shared: false });
  }

  const { data: zones, error: zonesError } = await account.db.from("buddy_privacy_zones")
    .select("lat,lng,radius_m").eq("user_id", account.user.id);
  if (zonesError) {
    console.error("Buddy location privacy zones could not be loaded", zonesError);
    return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
  }
  const point = { lat: input.data.lat, lng: input.data.lng };
  if (isInsidePrivacyZone(point, (zones ?? []).map((zone) => ({
    lat: zone.lat as number,
    lng: zone.lng as number,
    radius_m: zone.radius_m as number,
  })))) {
    const { error } = await account.db.from("buddy_live_locations").delete().eq("user_id", account.user.id);
    if (error) {
      console.error("Buddy location in a privacy zone could not be cleared", error);
      return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ shared: false, hiddenByPrivacyZone: true });
  }

  const now = new Date();
  const { data: previous, error: previousError } = await account.db.from("buddy_live_locations")
    .select("lat,lng,recorded_at").eq("user_id", account.user.id).maybeSingle();
  if (previousError) {
    console.error("Previous buddy location could not be checked", previousError);
    return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
  }
  if (previous && isFreshBuddyLocation(previous.recorded_at as string, now.getTime())
    && now.getTime() - Date.parse(previous.recorded_at as string) < 20_000) {
    return NextResponse.json({ shared: true, recordedAt: previous.recorded_at });
  }

  const { error: saveError } = await account.db.from("buddy_live_locations").upsert({
    user_id: account.user.id,
    lat: input.data.lat,
    lng: input.data.lng,
    accuracy_m: input.data.accuracyM ?? null,
    recorded_at: now.toISOString(),
  });
  if (saveError) {
    console.error("Buddy live location could not be saved", saveError);
    return NextResponse.json({ error: "location_sharing_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ shared: true, recordedAt: now.toISOString() });
}
