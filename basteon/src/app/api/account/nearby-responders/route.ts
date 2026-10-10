import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NEARBY_RADIUS_KM = 15;
const PRESENCE_MAX_AGE_MS = 15 * 60 * 1000;
const ACTIVE_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasLocation = params.has("lat") && params.has("lng") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: devices } = await db.from("devices").select("device_id").eq("user_id", user.id);
  const deviceIds = (devices ?? []).map((device) => device.device_id);
  let activeAlert: { id: string; type: string } | null = null;
  if (deviceIds.length) {
    const { data: alerts } = await db
      .from("alerts")
      .select("id,type_code,status,triggered_at")
      .in("device_id", deviceIds)
      .not("status", "in", "(resolved,false_alarm)")
      .gte("triggered_at", new Date(Date.now() - ACTIVE_ALERT_MAX_AGE_MS).toISOString())
      .order("triggered_at", { ascending: false })
      .limit(1);
    const alert = alerts?.[0];
    if (alert) activeAlert = { id: alert.id, type: alert.type_code === "medical" ? "medical" : "sos" };
  }

  if (!hasLocation) return NextResponse.json({ count: null, scope: null, radiusKm: NEARBY_RADIUS_KM, activeAlert });

  const { data: links } = await db
    .from("organisation_user_links")
    .select("organisation_id")
    .eq("user_id", user.id)
    .eq("status", "active");
  const linkedIds = [...new Set((links ?? []).map((link) => link.organisation_id))];

  let orgIds: string[] = [];
  let scope: "linked" | "partners" = "partners";
  if (linkedIds.length) {
    const { data: orgs } = await db
      .from("organisations")
      .select("id")
      .in("id", linkedIds)
      .eq("status", "active")
      .or(`blocked_until.is.null,blocked_until.lte.${nowIso}`);
    orgIds = (orgs ?? []).map((org) => org.id);
    scope = "linked";
  }
  if (!orgIds.length) {
    scope = "partners";
    const { data: orgs } = await db
      .from("organisations")
      .select("id")
      .eq("is_partner", true)
      .eq("status", "active")
      .or(`blocked_until.is.null,blocked_until.lte.${nowIso}`);
    orgIds = (orgs ?? []).map((org) => org.id);
  }
  if (!orgIds.length) return NextResponse.json({ count: 0, scope, radiusKm: NEARBY_RADIUS_KM, activeAlert });

  const { data: presence } = await db
    .from("responder_presence")
    .select("user_id,organisation_id,availability,last_lat,last_lng,last_seen_at")
    .in("organisation_id", orgIds)
    .eq("availability", "available");
  const { data: memberships } = await db
    .from("organisation_memberships")
    .select("user_id,organisation_id")
    .in("organisation_id", orgIds)
    .eq("status", "active")
    .in("role", ["responder", "dispatcher"]);
  const activeMembers = new Set((memberships ?? []).map((row) => `${row.organisation_id}:${row.user_id}`));

  const nearby = new Set<string>();
  for (const row of presence ?? []) {
    if (row.user_id === user.id || row.last_lat == null || row.last_lng == null || !row.last_seen_at) continue;
    if (Date.now() - new Date(row.last_seen_at).getTime() > PRESENCE_MAX_AGE_MS) continue;
    if (!activeMembers.has(`${row.organisation_id}:${row.user_id}`)) continue;
    if (distanceKm(lat, lng, Number(row.last_lat), Number(row.last_lng)) <= NEARBY_RADIUS_KM) nearby.add(row.user_id);
  }

  return NextResponse.json({ count: nearby.size, scope, radiusKm: NEARBY_RADIUS_KM, activeAlert }, { headers: { "Cache-Control": "no-store" } });
}
