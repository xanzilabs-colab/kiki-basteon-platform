import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId, requireOrganisationAccess } from "@/lib/organisation";
import { sendPushNotificationsToUser } from "@/lib/push";

const schema = z.object({
  alertId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const actorId = await currentUserId();
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const { memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  if (!memberships.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { data: result, error: resolveError } = await db.rpc("resolve_alert_for_operations", {
    p_alert_id: input.data.alertId,
    p_actor_id: actorId,
    p_note: input.data.note ?? null,
  });
  if (resolveError) {
    const message = resolveError.message.includes("not_found") ? "not_found"
      : resolveError.message.includes("closed_alert") ? "closed_alert"
        : resolveError.message.includes("forbidden") ? "forbidden"
          : "close_failed";
    const status = message === "not_found" ? 404 : message === "forbidden" ? 403 : message === "closed_alert" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const responderIds = [...new Set(Array.isArray(result) ? result.filter((id): id is string => typeof id === "string") : [])];
  if (responderIds.length) {
    const { error: notificationError } = await db.from("notifications").insert(responderIds.map((userId) => ({
      user_id: userId,
      type: "system",
      title: "Incident closed",
      body: "This emergency incident has been closed. No further response is required.",
      href: "/responder",
      payload: { alertId: input.data.alertId, status: "resolved" },
    })));
    if (notificationError) return NextResponse.json({ error: notificationError.message }, { status: 500 });
    await Promise.all(responderIds.map((userId) => sendPushNotificationsToUser(userId, {
      title: "Incident closed",
      body: "This emergency incident has been closed. No further response is required.",
      tag: `basteon-alert-resolved-${input.data.alertId}`,
      url: "/responder",
    })));
  }
  return NextResponse.json({ ok: true, status: "resolved" });
}
