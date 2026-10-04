import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pinInputSchema } from "@/lib/devicePin";
import { checkDevicePin, hasActiveAlert, logDeviceEvent, pinCheckResponse } from "@/lib/devicePin.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";

const inputSchema = z.object({
  device_id: z.string().trim().min(1).max(64),
  nickname: z.string().optional(),
  pin: pinInputSchema.optional(),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await client.from("profiles").select("full_name,phone").eq("id", user.id).single();
  if (!profile?.full_name?.trim() || !profile.phone?.trim()) return NextResponse.json({ error: "profile_incomplete" }, { status: 422 });

  const db = createAdminClient();
  const { data: device } = await db.from("devices").select("device_id,user_id,active,pin_locked").eq("device_id", input.data.device_id).maybeSingle();
  if (!device || !device.active) return NextResponse.json({ error: "device_not_registered" }, { status: 404 });
  if (device.user_id === user.id) return NextResponse.json({ already_linked: true });

  let transferFrom: string | null = null;
  if (device.user_id) {
    // Owned by someone else: only a PIN-locked band can change hands, and only with its PIN.
    if (!device.pin_locked) return NextResponse.json({ error: "already_owned" }, { status: 409 });
    const activeAlert = await hasActiveAlert(db, device.device_id);
    if (activeAlert === null) return NextResponse.json({ error: "could_not_start_link" }, { status: 500 });
    if (activeAlert) return NextResponse.json({ error: "active_alert" }, { status: 409 });
    if (!input.data.pin) return NextResponse.json({ error: "pin_required" }, { status: 409 });
    const check = await checkDevicePin(db, device.device_id, input.data.pin, user.id);
    if (!check.ok) return check.error === "no_pin" ? NextResponse.json({ error: "already_owned" }, { status: 409 }) : pinCheckResponse(check);
    transferFrom = device.user_id;
  }

  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from("device_link_tokens").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", cutoff);
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  await db.from("device_link_tokens").update({ expires_at: new Date().toISOString() }).eq("user_id", user.id).eq("device_id", device.device_id).is("used_at", null);
  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const nickname = input.data.nickname?.trim().slice(0, 40) || null;
  const { error } = await db.from("device_link_tokens").insert({
    user_id: user.id,
    device_id: device.device_id,
    token_hash: tokenHash,
    nickname,
    expires_at: expiresAt,
    transfer_from: transferFrom,
    pin_verified_at: transferFrom ? new Date().toISOString() : null,
  });
  if (error) return NextResponse.json({ error: "could_not_start_link" }, { status: 500 });
  if (transferFrom) await logDeviceEvent(db, device.device_id, user.id, "transfer_authorized");
  return NextResponse.json({ token, expires_at: expiresAt, transfer: Boolean(transferFrom) });
}