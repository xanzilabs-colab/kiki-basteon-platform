import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";
import { currentUserId, requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  alertId: z.string().uuid(),
  organisationId: z.string().uuid(),
  branchId: z.string().uuid(),
  responderUserId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request) {
  const actorId = await currentUserId();
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });

  const { memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  const membership = memberships.find((row: any) => row.organisation_id === payload.data.organisationId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (membership.branch_id && membership.branch_id !== payload.data.branchId && membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json({ error: "Branch mismatch." }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: target } = await db
    .from("alert_dispatch_targets")
    .select("id")
    .eq("alert_id", payload.data.alertId)
    .eq("organisation_id", payload.data.organisationId)
    .eq("branch_id", payload.data.branchId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Alert not routed to this branch." }, { status: 404 });

  const { data: assignment, error: assignmentError } = await db.from("alert_assignments").insert({
    alert_id: payload.data.alertId,
    organisation_id: payload.data.organisationId,
    branch_id: payload.data.branchId,
    responder_user_id: payload.data.responderUserId ?? null,
    unit_id: payload.data.unitId ?? null,
    status: "assigned",
    created_by: actorId,
  }).select("*").single();
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 400 });

  await db.from("alerts").update({
    assigned_to: payload.data.responderUserId ?? null,
    status: "acknowledged",
  }).eq("id", payload.data.alertId);
  await db.from("alert_dispatch_targets").update({ status: "accepted" }).eq("id", target.id);
  await db.from("alert_routing_events").insert({
    alert_id: payload.data.alertId,
    stage: "assigned",
    details: {
      assignment_id: assignment.id,
      organisation_id: payload.data.organisationId,
      branch_id: payload.data.branchId,
      responder_user_id: payload.data.responderUserId ?? null,
      unit_id: payload.data.unitId ?? null,
    },
  });

  if (payload.data.responderUserId) {
    await sendPushNotificationsToUser(payload.data.responderUserId, {
      title: "Assigned incident",
      body: "You have been assigned to an active emergency incident.",
      tag: `basteon-alert-assigned-${payload.data.alertId}`,
      url: "/responder",
    });
  }

  return NextResponse.json({ ok: true, assignment }, { status: 201 });
}

