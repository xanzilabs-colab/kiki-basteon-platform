import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ACTIVE_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createAdminClient();
  const { data: devices } = await db.from("devices").select("device_id").eq("user_id", user.id);
  const deviceIds = (devices ?? []).map((device) => device.device_id);
  if (!deviceIds.length) return NextResponse.json({ alert: null });

  const { data: alerts } = await db
    .from("alerts")
    .select("id,type_code,status,triggered_at")
    .in("device_id", deviceIds)
    .not("status", "in", "(resolved,false_alarm)")
    .gte("triggered_at", new Date(Date.now() - ACTIVE_ALERT_MAX_AGE_MS).toISOString())
    .order("triggered_at", { ascending: false })
    .limit(1);
  const alert = alerts?.[0];
  if (!alert) return NextResponse.json({ alert: null });

  const { data: assignments } = await db
    .from("alert_assignments")
    .select("status")
    .eq("alert_id", alert.id)
    .in("status", ["acknowledged", "en_route", "on_scene"]);
  const rows = assignments ?? [];
  return NextResponse.json({
    alert: {
      id: alert.id,
      type: alert.type_code === "medical" ? "medical" : "sos",
      status: alert.status,
      triggeredAt: alert.triggered_at,
      acknowledged: rows.length,
      enRoute: rows.filter((row) => row.status === "en_route").length,
      onScene: rows.filter((row) => row.status === "on_scene").length,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
