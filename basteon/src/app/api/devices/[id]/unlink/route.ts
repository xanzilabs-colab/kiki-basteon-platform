import { NextResponse } from "next/server";
import { z } from "zod";
import { pinInputSchema } from "@/lib/devicePin";
import { checkDevicePin, hasActiveAlert, logDeviceEvent, pinCheckResponse } from "@/lib/devicePin.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({ pin: pinInputSchema.optional() });

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await context.params;
  const input = inputSchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = profile?.role === "admin";
  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("device_id,user_id,pin_locked").eq("id", id).maybeSingle();
  if (!device || (device.user_id !== user.id && !isAdmin)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Admins manage the fleet from the console; owners must clear the same gates as a transfer.
  if (!isAdmin) {
    const activeAlert = await hasActiveAlert(db, device.device_id);
    if (activeAlert === null) return NextResponse.json({ error: "unlink_failed" }, { status: 500 });
    if (activeAlert) return NextResponse.json({ error: "active_alert" }, { status: 409 });
    if (device.pin_locked) {
      if (!input.data.pin) return NextResponse.json({ error: "pin_required" }, { status: 409 });
      const check = await checkDevicePin(db, device.device_id, input.data.pin, user.id);
      if (!check.ok && check.error !== "no_pin") return pinCheckResponse(check);
    }
  }

  let update = db.from("devices").update({ user_id: null, linked_at: null, unlinked_at: new Date().toISOString(), unlinked_by: user.id }).eq("id", id);
  // Only unlink the owner we checked; a transfer in between must not be undone by the previous owner.
  if (device.user_id) update = update.eq("user_id", device.user_id);
  const { data: updated, error } = await update.select("id");
  if (error) return NextResponse.json({ error: "unlink_failed" }, { status: 500 });
  if (!updated?.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await logDeviceEvent(db, device.device_id, user.id, "unlinked", { by_admin: isAdmin });
  return NextResponse.json({ ok: true });
}