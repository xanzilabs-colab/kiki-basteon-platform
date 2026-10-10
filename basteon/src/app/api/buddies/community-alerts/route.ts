import { alertSchema, coordinates } from "@/lib/buddies/meeting/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { coarsen, intelExpiry, sanitizeSummary, type IntelKind } from "@/lib/communityIntel";
import { meetingBody, meetingError, meetingJson, meetingRpc, meetingSession } from "../_meeting";

/** Derives a sanitized, coarse intelligence record from the raw report; the raw report is left untouched. */
async function recordIntel(alertId: string) {
  const db = createAdminClient();
  const { data: alert } = await db.from("buddy_community_alerts").select("id,reporter_id,kind,lat,lng,detail,created_at").eq("id", alertId).maybeSingle();
  if (!alert) return;
  const created = new Date(alert.created_at);
  await db.from("community_intel_records").upsert({
    source_alert_id: alert.id, reporter_id: alert.reporter_id, kind: alert.kind, lat: coarsen(alert.lat), lng: coarsen(alert.lng),
    summary: sanitizeSummary(alert.detail), incident_at: created.toISOString(), submitted_at: created.toISOString(), expires_at: intelExpiry(alert.kind as IntelKind, created).toISOString(),
  }, { onConflict: "source_alert_id" });
  await db.channel("community-alerts").send({ type: "broadcast", event: "changed", payload: {} }).catch(() => undefined);
}

export async function GET(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const query = new URL(request.url).searchParams;
    const parsed = coordinates.safeParse({ lat: query.has("lat") ? Number(query.get("lat")) : undefined, lng: query.has("lng") ? Number(query.get("lng")) : undefined });
    if (!parsed.success) return meetingJson({ error: "invalid_location" }, 400);
    const { lat, lng } = parsed.data;
    return meetingJson({ alerts: await meetingRpc(client, "list_community_alerts_near", { p_lat: lat, p_lng: lng, p_radius_m: 10000 }) });
  } catch (error) { return meetingError(error); }
}

export async function POST(request: Request) {
  try {
    const { client } = await meetingSession(request);
    const body = await meetingBody(request, alertSchema);
    if (!body) return meetingJson({ error: "invalid_alert" }, 400);
    const id = await meetingRpc(client, "report_community_alert_detail", { p_kind: body.kind, p_lat: body.lat, p_lng: body.lng, p_location_label: body.locationLabel, p_detail: body.detail });
    await recordIntel(String(id)).catch((error) => console.error("Community intel record failed", error));
    return meetingJson({ id }, 201);
  } catch (error) { return meetingError(error); }
}