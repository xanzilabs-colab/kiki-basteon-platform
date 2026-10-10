import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";
import { createNotification } from "@/lib/notifications";
import { buildMessage, classifyZone, corroboration, intelConfig, shouldAlert, type AlertHistory, type IntelRecord, type IntelZone } from "@/lib/communityIntel";
import { distanceM } from "@/lib/hamba/geometry";

export const dynamic = "force-dynamic";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** Called with the user's position. Consent is re-checked server-side; the position is used transiently and never stored here. */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_location" }, { status: 400 });
  const db = createAdminClient();
  const { data: consent } = await db.from("user_privacy_settings").select("live_location_sharing,safety_intel_alerts").eq("user_id", userId).maybeSingle();
  if (!consent?.live_location_sharing || !consent.safety_intel_alerts) return NextResponse.json({ sent: 0, skipped: "consent_off" });

  const cfg = intelConfig();
  const now = Date.now();
  const degLat = cfg.outerM / 111_320;
  const degLng = degLat / Math.max(0.2, Math.cos(input.data.lat * Math.PI / 180));
  const { data: rows } = await db.from("community_intel_records")
    .select("id,kind,lat,lng,summary,status,reporter_id,incident_at,expires_at")
    .neq("status", "rejected").gt("expires_at", new Date(now).toISOString())
    .gte("lat", input.data.lat - degLat).lte("lat", input.data.lat + degLat)
    .gte("lng", input.data.lng - degLng).lte("lng", input.data.lng + degLng).limit(100);
  const records: IntelRecord[] = (rows ?? []).filter((row) => row.reporter_id !== userId).map((row) => ({
    id: row.id, kind: row.kind, lat: row.lat, lng: row.lng, summary: row.summary, status: row.status, reporterId: row.reporter_id, incidentAt: row.incident_at, expiresAt: row.expires_at,
  }));
  if (records.length === 0) return NextResponse.json({ sent: 0 });

  const { data: logs } = await db.from("safety_intel_alert_log").select("record_id,zone,sent_at").eq("user_id", userId).gt("sent_at", new Date(now - cfg.cooldownMs).toISOString());
  const history: AlertHistory = (logs ?? []).map((log) => ({ recordId: log.record_id, zone: log.zone as IntelZone, sentAt: new Date(log.sent_at).getTime() }));

  let sent = 0;
  for (const record of records.sort((a, b) => distanceM(input.data, a) - distanceM(input.data, b))) {
    const zone = classifyZone(distanceM(input.data, record), cfg);
    if (!zone || !shouldAlert(record, zone, history, cfg, now)) continue;
    // One alert per evaluation keeps this from becoming noisy; the next nearest waits for the next fix.
    const message = buildMessage(record, zone, corroboration(record, records, cfg, now), now);
    await db.from("safety_intel_alert_log").insert({ user_id: userId, record_id: record.id, zone });
    await createNotification({ userId, type: "safety_intel", title: message.title, body: message.body, href: "/account/buddies", payload: { recordId: record.id, zone } });
    sent += 1;
    break;
  }
  return NextResponse.json({ sent });
}
