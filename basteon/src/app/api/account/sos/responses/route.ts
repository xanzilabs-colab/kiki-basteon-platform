import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const respondingStatuses = ["acknowledged", "en_route", "on_scene"];
const LIVE_POSITION_MAX_AGE_MS = 90_000;

export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const alertId = new URL(request.url).searchParams.get("alert_id");
  if (!alertId) return NextResponse.json({ error: "alert_id required" }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,status,type_code,lat,lng,triggered_at,updated_at,device_id")
    .eq("id", alertId)
    .maybeSingle();
  if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
  if (!alert) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: device, error: deviceError } = await db
    .from("devices")
    .select("user_id")
    .eq("device_id", alert.device_id)
    .maybeSingle();
  if (deviceError) return NextResponse.json({ error: deviceError.message }, { status: 500 });
  if (device?.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (alert.status === "resolved" || alert.status === "false_alarm") {
    return NextResponse.json({
      alert: {
        id: alert.id,
        status: alert.status,
        typeCode: alert.type_code,
        lat: alert.lat,
        lng: alert.lng,
        triggeredAt: alert.triggered_at,
        updatedAt: alert.updated_at,
      },
      responders: [],
      serverTime: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: assignments, error: assignmentsError } = await db
    .from("alert_assignments")
    .select("id,responder_user_id,status,assigned_at,acknowledged_at")
    .eq("alert_id", alertId)
    .in("status", respondingStatuses)
    .not("responder_user_id", "is", null)
    .order("assigned_at", { ascending: true });
  if (assignmentsError) return NextResponse.json({ error: assignmentsError.message }, { status: 500 });

  const responderIds = [...new Set((assignments ?? []).map((row) => row.responder_user_id).filter((id): id is string => Boolean(id)))];
  const [{ data: presence, error: presenceError }, { data: profiles, error: profilesError }] = responderIds.length
    ? await Promise.all([
        db.from("responder_presence").select("user_id,last_lat,last_lng,last_seen_at").in("user_id", responderIds),
        db.from("profiles").select("id,full_name").in("id", responderIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (presenceError) return NextResponse.json({ error: presenceError.message }, { status: 500 });
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const now = Date.now();
  const presenceByUser = new Map((presence ?? []).map((row) => [row.user_id, row]));
  const nameByUser = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
  const responders = (assignments ?? []).map((assignment) => {
    const latest = presenceByUser.get(assignment.responder_user_id);
    const seenAt = latest?.last_seen_at ? new Date(latest.last_seen_at).getTime() : 0;
    const locationIsFresh = now - seenAt <= LIVE_POSITION_MAX_AGE_MS
      && latest?.last_lat != null
      && latest?.last_lng != null;
    return {
      id: assignment.id,
      name: nameByUser.get(assignment.responder_user_id) || "Kiki responder",
      status: assignment.status,
      acceptedAt: assignment.acknowledged_at ?? assignment.assigned_at,
      location: locationIsFresh
        ? { lat: latest.last_lat, lng: latest.last_lng, seenAt: latest.last_seen_at }
        : null,
    };
  });

  return NextResponse.json({
    alert: {
      id: alert.id,
      status: alert.status,
      typeCode: alert.type_code,
      lat: alert.lat,
      lng: alert.lng,
      triggeredAt: alert.triggered_at,
      updatedAt: alert.updated_at,
    },
    responders,
    serverTime: new Date(now).toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
