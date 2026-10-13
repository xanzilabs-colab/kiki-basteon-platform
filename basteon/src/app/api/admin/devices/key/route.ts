import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logDeviceEvent } from "@/lib/devicePin.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ device_id: z.string().min(1).max(64) });

export async function POST(request: Request) {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: profile, error: profileError } = await session.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const input = inputSchema.safeParse((await request.json().catch(() => null)) ?? null);
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = createAdminClient();
  const { data: device, error: deviceError } = await db.from("devices").select("device_id,last_ctr").eq("device_id", input.data.device_id).maybeSingle();
  if (deviceError) return NextResponse.json({ error: "device_lookup_failed" }, { status: 500 });
  if (!device) return NextResponse.json({ error: "device_not_found" }, { status: 404 });
  const last_ctr = Number(device.last_ctr);
  if (!Number.isSafeInteger(last_ctr) || last_ctr < 0 || last_ctr > 0xffff_ffff) {
    return NextResponse.json({ error: "device_counter_out_of_range" }, { status: 409 });
  }

  const key_b64 = randomBytes(32).toString("base64");
  const { error: keyError } = await db.from("device_secrets")
    .upsert({ device_id: device.device_id, key_b64 }, { onConflict: "device_id" });
  if (keyError) return NextResponse.json({ error: "device_key_rotation_failed" }, { status: 500 });

  await logDeviceEvent(db, device.device_id, user.id, "admin_device_key_rotated");
  return NextResponse.json({ key_b64, last_ctr });
}
