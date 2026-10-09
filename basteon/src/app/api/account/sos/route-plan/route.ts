import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const LIVE_POSITION_MAX_AGE_MS = 90_000;

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const alertId = params.get("alert_id");
  const assignmentId = params.get("assignment_id");
  if (!alertId || !assignmentId) return NextResponse.json({ error: "alert_id and assignment_id required" }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("device_id,lat,lng,status")
    .eq("id", alertId)
    .maybeSingle();
  if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
  if (!alert) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (alert.status === "resolved" || alert.status === "false_alarm") return NextResponse.json({ error: "closed_alert" }, { status: 409 });

  const { data: device, error: deviceError } = await db
    .from("devices")
    .select("user_id")
    .eq("device_id", alert.device_id)
    .maybeSingle();
  if (deviceError) return NextResponse.json({ error: deviceError.message }, { status: 500 });
  if (device?.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (alert.lat == null || alert.lng == null) return NextResponse.json({ error: "caller_location_unavailable" }, { status: 409 });

  const { data: assignment, error: assignmentError } = await db
    .from("alert_assignments")
    .select("responder_user_id,status")
    .eq("id", assignmentId)
    .eq("alert_id", alertId)
    .in("status", ["acknowledged", "en_route", "on_scene"])
    .maybeSingle();
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 500 });
  if (!assignment?.responder_user_id) return NextResponse.json({ error: "response_not_active" }, { status: 409 });

  const { data: presence, error: presenceError } = await db
    .from("responder_presence")
    .select("last_lat,last_lng,last_seen_at")
    .eq("user_id", assignment.responder_user_id)
    .maybeSingle();
  if (presenceError) return NextResponse.json({ error: presenceError.message }, { status: 500 });
  const seenAt = presence?.last_seen_at ? new Date(presence.last_seen_at).getTime() : 0;
  if (!presence || Date.now() - seenAt > LIVE_POSITION_MAX_AGE_MS || presence.last_lat == null || presence.last_lng == null) {
    return NextResponse.json({ error: "responder_location_stale" }, { status: 409 });
  }

  const routeBase = process.env.SOS_ROUTING_URL;
  if (!routeBase) return NextResponse.json({ error: "routing_unconfigured" }, { status: 503 });

  let routeUrl: URL;
  try {
    routeUrl = new URL(`${routeBase.replace(/\/+$/, "")}/route/v1/driving/${presence.last_lng},${presence.last_lat};${alert.lng},${alert.lat}?overview=full&geometries=geojson`);
  } catch {
    return NextResponse.json({ error: "routing_configuration_invalid" }, { status: 500 });
  }
  if (!["http:", "https:"].includes(routeUrl.protocol)) return NextResponse.json({ error: "routing_configuration_invalid" }, { status: 500 });

  try {
    const response = await fetch(routeUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return NextResponse.json({ error: "routing_unavailable" }, { status: 502 });
    const data = await response.json() as {
      routes?: Array<{ distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }>;
    };
    const route = data.routes?.[0];
    if (!route || !route.geometry?.coordinates?.length) return NextResponse.json({ error: "route_not_found" }, { status: 404 });
    return NextResponse.json({
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      points: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "routing_unavailable" }, { status: 502 });
  }
}
