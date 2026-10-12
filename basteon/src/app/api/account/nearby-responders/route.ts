import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEARBY_RADIUS_KM, RESPONDER_ROLES, countAvailableResponders, filterNearbyResponders, selectDiscoveryOrganisations } from "@/lib/nearbyResponders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasLocation = params.has("lat") && params.has("lng") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const db = createAdminClient();
  const [{ data: links, error: linksError }, { data: memberships, error: membershipError }] = await Promise.all([
    db.from("organisation_user_links").select("organisation_id").eq("user_id", user.id).eq("status", "active"),
    db.from("organisation_memberships").select("organisation_id").eq("user_id", user.id).eq("status", "active"),
  ]);
  if (linksError || membershipError) {
    console.error("nearby responders linked organisation lookup failed", linksError ?? membershipError);
    return NextResponse.json({ error: "responder_scope_unavailable" }, { status: 500 });
  }
  const linkedIds = [...new Set([
    ...(links ?? []).map((link) => link.organisation_id),
    ...(memberships ?? []).map((membership) => membership.organisation_id),
  ])];

  const { data: orgs, error: organisationsError } = await db
    .from("organisations")
    .select("id,name,is_partner,status,blocked_until")
    .or(linkedIds.length ? `is_partner.eq.true,id.in.(${linkedIds.join(",")})` : "is_partner.eq.true");
  if (organisationsError) {
    console.error("nearby responders organisation lookup failed", organisationsError);
    return NextResponse.json({ error: "responder_scope_unavailable" }, { status: 500 });
  }
  const { scope, organisations } = selectDiscoveryOrganisations(linkedIds, orgs ?? []);
  const orgIds = organisations.map((org) => org.id);
  if (!orgIds.length) return NextResponse.json({
    count: hasLocation ? 0 : null,
    availableCount: 0,
    scope,
    radiusKm: NEARBY_RADIUS_KM,
    responders: [],
  }, { headers: { "Cache-Control": "no-store" } });

  const [{ data: presence, error: presenceError }, { data: responderMemberships, error: responderMembershipError }] = await Promise.all([
    db.from("responder_presence").select("user_id,organisation_id,availability,last_lat,last_lng,last_seen_at").in("organisation_id", orgIds).eq("availability", "available"),
    db.from("organisation_memberships").select("user_id,organisation_id,role,status").in("organisation_id", orgIds).eq("status", "active").in("role", [...RESPONDER_ROLES]),
  ]);
  if (presenceError || responderMembershipError) {
    console.error("nearby responders availability lookup failed", presenceError ?? responderMembershipError);
    return NextResponse.json({ error: "responder_availability_unavailable" }, { status: 500 });
  }
  const availableCount = countAvailableResponders({
    organisationIds: orgIds,
    presence: presence ?? [],
    memberships: responderMemberships ?? [],
    excludeUserId: user.id,
  });
  const nearby = hasLocation ? filterNearbyResponders({
    origin: { lat, lng },
    organisationIds: orgIds,
    presence: presence ?? [],
    memberships: responderMemberships ?? [],
    excludeUserId: user.id,
  }) : [];

  const { data: profiles, error: profilesError } = nearby.length
    ? await db.from("profiles").select("id,full_name").in("id", nearby.map((item) => item.userId))
    : { data: [] as Array<{ id: string; full_name: string | null }>, error: null };
  if (profilesError) {
    console.error("nearby responders profile lookup failed", profilesError);
    return NextResponse.json({ error: "responder_availability_unavailable" }, { status: 500 });
  }
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const orgNames = new Map(organisations.map((org) => [org.id, org.name ?? "Organisation"]));

  return NextResponse.json({
    count: hasLocation ? nearby.length : null,
    availableCount,
    scope,
    radiusKm: NEARBY_RADIUS_KM,
    responders: nearby.map((item) => ({
      id: item.userId,
      name: names.get(item.userId) || "Kiki responder",
      role: item.role,
      organisation: orgNames.get(item.organisationId) ?? "Organisation",
      distanceKm: Math.round(item.distanceKm * 10) / 10,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
