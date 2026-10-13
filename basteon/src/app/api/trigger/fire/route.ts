import { after, NextResponse } from "next/server";
import { z } from "zod";
import { sendPushNotificationsToUser } from "@/lib/push";
import { admin, isInvalidTokenError, noStore, readJson, readToken, sha256 } from "@/lib/triggerRoute";
import { processTriggerWork } from "@/lib/triggerWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  type: z.enum(["sos", "medical"]).default("sos"),
  duress: z.boolean().default(false),
  test: z.boolean().default(false),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().min(0).max(100000).optional(),
  loc_at: z.string().datetime().optional(),
  src: z.enum(["bt_media", "bt_ble"]).optional(),
  pattern: z.string().max(20).optional(),
  profile: z.string().max(12).optional(),
  sig_verified: z.boolean().optional(),
}).strict().refine((value) => (value.lat === undefined) === (value.lng === undefined), {
  message: "Latitude and longitude must be supplied together.",
});

export async function POST(request: Request) {
  const token = readToken(request);
  if (!token) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });

  const body = await readJson(request);
  const parsed = Body.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: noStore });

  const { data, error } = await admin().rpc("trigger_fire", {
    p_token_hash: sha256(token),
    p_payload: parsed.data,
  });
  if (error) {
    if (/no_active_device/.test(error.message)) {
      return NextResponse.json({ ok: false, error: "no_active_device" }, { status: 409, headers: noStore });
    }
    return NextResponse.json(
      { ok: false },
      { status: isInvalidTokenError(error.message) ? 401 : 500, headers: noStore },
    );
  }
  if (data?.error === "rate_limited") {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: noStore });
  }

  let delivery: Awaited<ReturnType<typeof sendPushNotificationsToUser>> | null = null;
  if (!data?.test && !data?.reused && data?.user_id) {
    const seconds = Number.isInteger(data.countdown_s) ? data.countdown_s : 10;
    const activationTime = typeof data.activates_at === "string" ? Date.parse(data.activates_at) : Number.NaN;
    const activateAt = Number.isFinite(activationTime) ? activationTime : Date.now() + seconds * 1000;
    after(async () => {
      const remainingMs = Math.max(0, activateAt - Date.now());
      if (remainingMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
      await processTriggerWork();
    });
    delivery = await sendPushNotificationsToUser(data.user_id, {
      title: "Kiki",
      body: `Alert starts in ${seconds} seconds. Tap to cancel.`,
      tag: `kiki-trigger-${data.pending_id}`,
      url: "/account",
      actions: [{ action: "cancel-alert", title: "Cancel alert" }],
      data: { pendingId: data.pending_id },
    });
  }

  const { user_id: _private, ...safe } = data ?? {};
  return NextResponse.json(delivery ? { ...safe, delivery } : safe, { headers: noStore });
}
