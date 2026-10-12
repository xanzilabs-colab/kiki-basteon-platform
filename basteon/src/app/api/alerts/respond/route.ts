import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";
import { createNotification } from "@/lib/notifications";

const schema = z.object({
  alertId: z.string().uuid(),
  action: z.enum(["accept", "en_route", "on_scene", "withdraw", "location"]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine((value) => value.action !== "location" || (value.lat !== undefined && value.lng !== undefined), {
  message: "A location update requires latitude and longitude.",
});

export async function POST(request: Request) {
  const actorId = await currentUserId();
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,status,assigned_to,device_id")
    .eq("id", payload.data.alertId)
    .maybeSingle();
  if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 });
  if (!alert) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (alert.status === "resolved" || alert.status === "false_alarm") {
    return NextResponse.json({ error: "closed_alert" }, { status: 409 });
  }

  const { data: memberships, error: membershipError } = await db
    .from("organisation_memberships")
    .select("organisation_id,branch_id,role")
    .eq("user_id", actorId)
    .eq("status", "active")
    .in("role", ["responder", "dispatcher"]);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!memberships?.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: targets, error: targetError } = await db
    .from("alert_dispatch_targets")
    .select("id,organisation_id,branch_id")
    .eq("alert_id", payload.data.alertId)
    .in("status", ["pending", "accepted", "escalated"]);
  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });

  const dispatch = (targets ?? []).flatMap((target) => {
    const membership = memberships.find((row) =>
      row.organisation_id === target.organisation_id
      && (target.branch_id === null || row.branch_id === null || row.branch_id === target.branch_id),
    );
    const branchId = target.branch_id ?? membership?.branch_id ?? null;
    return membership && branchId
      ? [{ target, membership, branchId }]
      : [];
  })[0];
  if (!dispatch) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: assignmentId, error: responseError } = await db.rpc("apply_alert_response", {
    p_alert_id: payload.data.alertId,
    p_actor_id: actorId,
    p_organisation_id: dispatch.membership.organisation_id,
    p_branch_id: dispatch.branchId,
    p_action: payload.data.action,
    p_lat: payload.data.lat ?? null,
    p_lng: payload.data.lng ?? null,
  });
  if (responseError) {
    const message = responseError.message.includes("closed_alert")
      ? "closed_alert"
      : responseError.message.includes("response_not_accepted")
        ? "response_not_accepted"
        : responseError.message.includes("forbidden")
          ? "forbidden"
          : "response_update_failed";
    const status = message === "forbidden" ? 403 : message === "response_update_failed" ? 500 : 409;
    return NextResponse.json({ error: message }, { status });
  }
  const { data: assignment } = await db.from("alert_assignments")
    .select("status")
    .eq("id", assignmentId)
    .maybeSingle();

  if (payload.data.action !== "location") {
    const eventAction = payload.data.action === "accept"
      ? "acknowledged"
      : payload.data.action === "withdraw" ? "withdrawn" : payload.data.action;
    const { data: statusEvent, error: statusEventError } = await db.from("alert_assignment_events")
      .select("from_status,to_status")
      .eq("alert_id", payload.data.alertId)
      .eq("assignment_id", assignmentId)
      .eq("actor_id", actorId)
      .eq("action", eventAction)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (statusEventError) {
      console.error("Responder alert status event lookup failed", statusEventError);
    } else if (statusEvent && statusEvent.from_status !== statusEvent.to_status) {
      const { data: device, error: deviceError } = await db.from("devices")
        .select("user_id")
        .eq("device_id", alert.device_id)
        .maybeSingle();
      const { data: responder, error: responderError } = await db.from("profiles")
        .select("full_name")
        .eq("id", actorId)
        .maybeSingle();
      if (deviceError || responderError) {
        console.error("Responder alert notification recipient lookup failed", deviceError ?? responderError);
      } else if (device?.user_id && device.user_id !== actorId) {
        const responderName = responder?.full_name?.trim() || "A responder";
        const statusMessage: Record<string, string> = {
          acknowledged: "has acknowledged your alert.",
          en_route: "is on the way to you.",
          on_scene: "has arrived at your location.",
          cancelled: "is no longer responding to your alert.",
        };
        const message = statusMessage[statusEvent.to_status] ?? "updated their response to your alert.";
        const title = statusEvent.to_status === "on_scene" ? "Responder arrived" : "Responder status updated";
        const body = `${responderName} ${message}`;
        const notificationIds = await createNotification({
          userId: device.user_id,
          type: "system",
          title,
          body,
          href: "/account",
          payload: {
            alertId: payload.data.alertId,
            assignmentId: String(assignmentId),
            status: statusEvent.to_status,
          },
        }, db);
        if (!notificationIds.length) {
          console.error("Responder alert status notification could not be persisted", {
            alertId: payload.data.alertId,
            responderId: actorId,
            status: statusEvent.to_status,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, assignmentId, status: assignment?.status ?? payload.data.action });
}
