import { NextResponse } from "next/server";
import { z } from "zod";
import { logDeviceEvent } from "@/lib/devicePin.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

const schema = z.object({ device_id: z.string().trim().min(1).max(64), action: z.enum(["reset", "clear_lockout"]) }).strict();

/** Admin PIN support actions. Never returns hashes; the band wipes its own PIN on the next heartbeat after a reset. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = createAdminClient();
  const { device_id: deviceId, action } = input.data;
  const query = action === "reset"
    ? db.from("device_pins").delete().eq("device_id", deviceId).select("device_id")
    : db.from("device_pins").update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("device_id", deviceId).select("device_id");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "pin_unavailable" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "no_pin" }, { status: 404 });
  await logDeviceEvent(db, deviceId, user.id, action === "reset" ? "admin_pin_reset" : "admin_lockout_cleared");
  if (action === "reset") {
    const { data: device } = await db.from("devices").select("user_id,device_name").eq("device_id", deviceId).maybeSingle();
    if (device?.user_id) {
      await db.from("notifications").insert({
        user_id: device.user_id,
        type: "system",
        title: "Band PIN removed by support",
        body: `The PIN on ${device.device_name} was reset by Kiki support. Set a new PIN from My devices.`,
        href: "/account/devices",
      });
    }
  }
  return NextResponse.json({ ok: true });
}
