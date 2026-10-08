import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const inputSchema = z.object({
  alert_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).max(400).optional(),
  heading_deg: z.number().int().min(0).max(359).optional(),
  motion_state: z.enum(["unknown", "still", "walking", "vehicle"]).optional(),
  is_moving: z.boolean().optional(),
  sats: z.number().int().min(0).max(100).optional(),
  hdop: z.number().min(0).max(99).optional(),
  fix_age_s: z.number().int().min(0).max(86_400).optional(),
});

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const payload = await request.json().catch(() => null);
  const input = inputSchema.safeParse(payload ?? {});
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,device_id,status")
    .eq("id", input.data.alert_id)
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
  if (!device || device.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ctr = -Date.now();
  const { data: outcome, error: updateError } = await db.rpc("record_panic_update", {
    p_alert_id: alert.id,
    p_device_id: alert.device_id,
    p_lat: input.data.lat,
    p_lng: input.data.lng,
    p_loc_source: "gps",
    p_fix_age_s: input.data.fix_age_s ?? 0,
    p_battery: null,
    p_ctr: ctr,
    p_source: "phone",
    p_speed_kmh: input.data.speed_kmh ?? null,
    p_heading_deg: input.data.heading_deg ?? null,
    p_motion_state: input.data.motion_state ?? "unknown",
    p_is_moving: input.data.is_moving ?? false,
    p_motion_src: "phone_gps",
    p_activity_mg: null,
    p_sats: input.data.sats ?? null,
    p_hdop: input.data.hdop ?? null,
  });
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  if (outcome === "stop") return NextResponse.json({ error: "closed_alert" }, { status: 409 });

  return NextResponse.json({ ok: true, state: outcome ?? "recorded" });
}
