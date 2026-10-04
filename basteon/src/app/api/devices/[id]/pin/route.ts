import { NextResponse } from "next/server";
import { z } from "zod";
import { newPinSchema, pinInputSchema } from "@/lib/devicePin";
import { checkDevicePin, hashDevicePin, logDeviceEvent, pinCheckResponse } from "@/lib/devicePin.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

type Context = { params: Promise<{ id: string }> };

const setSchema = z.object({ pin: newPinSchema }).strict();
const changeSchema = z.object({ current_pin: pinInputSchema, new_pin: newPinSchema }).strict();
const removeSchema = z.object({ pin: pinInputSchema }).strict();

async function owned(request: Request, context: Context) {
  if (!sameOrigin(request)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("device_id,user_id,pin_locked").eq("id", id).maybeSingle();
  if (!device || device.user_id !== user.id) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { user, db, device };
}

function invalid(issues: z.ZodError) {
  const weak = issues.issues.some((issue) => issue.message === "weak_pin");
  return NextResponse.json({ error: weak ? "weak_pin" : "invalid_request" }, { status: 400 });
}

const storeErrors: Record<string, [string, number]> = {
  not_owner: ["forbidden", 403],
  exists: ["pin_already_set", 409],
  no_pin: ["no_pin", 409],
};

/** Set a PIN on a band that has none. The app writes the matching verifier to the band over BLE. */
export async function POST(request: Request, context: Context) {
  const access = await owned(request, context);
  if (access.error) return access.error;
  const input = setSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return invalid(input.error);
  if (access.device.pin_locked) return NextResponse.json({ error: "pin_already_set" }, { status: 409 });

  const { data, error } = await access.db.rpc("device_pin_store", {
    p_device_id: access.device.device_id,
    p_owner: access.user.id,
    p_pin_hash: await hashDevicePin(input.data.pin),
    p_mode: "create",
  });
  if (error) return NextResponse.json({ error: "pin_unavailable" }, { status: 503 });
  if (data !== "ok") {
    const [code, status] = storeErrors[String(data)] ?? ["pin_unavailable", 503];
    return NextResponse.json({ error: code }, { status });
  }
  await logDeviceEvent(access.db, access.device.device_id, access.user.id, "pin_set");
  return NextResponse.json({ ok: true, pin_locked: true });
}

/** Change (or re-sync) the PIN. Requires the current PIN. */
export async function PUT(request: Request, context: Context) {
  const access = await owned(request, context);
  if (access.error) return access.error;
  const input = changeSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return invalid(input.error);

  const check = await checkDevicePin(access.db, access.device.device_id, input.data.current_pin, access.user.id);
  if (!check.ok) return pinCheckResponse(check);

  const { data, error } = await access.db.rpc("device_pin_store", {
    p_device_id: access.device.device_id,
    p_owner: access.user.id,
    p_pin_hash: await hashDevicePin(input.data.new_pin),
    p_mode: "replace",
  });
  if (error) return NextResponse.json({ error: "pin_unavailable" }, { status: 503 });
  if (data !== "ok") {
    const [code, status] = storeErrors[String(data)] ?? ["pin_unavailable", 503];
    return NextResponse.json({ error: code }, { status });
  }
  await logDeviceEvent(access.db, access.device.device_id, access.user.id, "pin_changed");
  return NextResponse.json({ ok: true, pin_locked: true });
}

/** Remove the PIN. The band drops its own copy on its next heartbeat (`pin_clear`). */
export async function DELETE(request: Request, context: Context) {
  const access = await owned(request, context);
  if (access.error) return access.error;
  const input = removeSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return invalid(input.error);

  const check = await checkDevicePin(access.db, access.device.device_id, input.data.pin, access.user.id);
  if (!check.ok) return pinCheckResponse(check);

  const { error } = await access.db.from("device_pins").delete().eq("device_id", access.device.device_id).eq("owner_id", access.user.id);
  if (error) return NextResponse.json({ error: "pin_unavailable" }, { status: 503 });
  await logDeviceEvent(access.db, access.device.device_id, access.user.id, "pin_removed");
  return NextResponse.json({ ok: true, pin_locked: false });
}
