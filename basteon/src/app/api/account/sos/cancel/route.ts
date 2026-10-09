import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";

const schema = z.object({ alert_id: z.string().uuid() });
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,status,device_id")
    .eq("id", input.data.alert_id)
    .maybeSingle();
  if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
  if (!alert) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: device, error: deviceError } = await db
    .from("devices")
    .select("user_id")
    .eq("device_id", alert.device_id)
    .maybeSingle();
  if (deviceError) return NextResponse.json({ error: deviceError.message }, { status: 500 });
  if (device?.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (alert.status === "resolved") return NextResponse.json({ error: "alert_already_resolved" }, { status: 409 });
  if (alert.status === "false_alarm") return NextResponse.json({ ok: true, status: "false_alarm" });

  const { data: responderResult, error: cancelError } = await db.rpc("cancel_sos_as_false_alarm", {
    p_alert_id: alert.id,
    p_actor_id: user.id,
  });
  if (cancelError) {
    const error = cancelError.message.includes("alert_already_resolved") ? "alert_already_resolved"
      : cancelError.message.includes("forbidden") ? "forbidden"
        : "cancel_failed";
    return NextResponse.json({ error }, { status: error === "forbidden" ? 403 : error === "alert_already_resolved" ? 409 : 500 });
  }
  const responderIds = [...new Set(Array.isArray(responderResult) ? responderResult.filter((id): id is string => typeof id === "string") : [])];
  if (responderIds.length) {
    const { error: notificationError } = await db.from("notifications").insert(responderIds.map((userId) => ({
      user_id: userId,
      type: "system",
      title: "Alert cancelled",
      body: "The caller reported this as a false alarm. No response is required.",
      href: "/responder",
      payload: { alertId: alert.id, status: "false_alarm" },
    })));
    if (notificationError) return NextResponse.json({ error: notificationError.message }, { status: 500 });
    await Promise.all(responderIds.map((userId) => sendPushNotificationsToUser(userId, {
      title: "Alert cancelled",
      body: "The caller reported this as a false alarm. No response is required.",
      tag: `basteon-alert-cancelled-${alert.id}`,
      url: "/responder",
    })));
  }

  return NextResponse.json({ ok: true, status: "false_alarm" });
}
