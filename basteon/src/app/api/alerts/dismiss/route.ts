import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/organisation";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/verification/http";

const schema = z.object({ alertId: z.string().uuid() });

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("responder_alert_dismissals")
    .select("alert_id")
    .eq("user_id", userId);
  if (error) {
    console.error("Responder alert dismissals could not be loaded", error);
    return NextResponse.json({ error: "dismissals_unavailable" }, { status: 500 });
  }
  return NextResponse.json({ dismissedAlertIds: (data ?? []).map((row) => row.alert_id) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_alert" }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db
    .from("alerts")
    .select("id,status")
    .eq("id", input.data.alertId)
    .maybeSingle();
  if (alertError) {
    console.error("Responder alert dismissal status lookup failed", alertError);
    return NextResponse.json({ error: "dismissal_unavailable" }, { status: 500 });
  }
  if (!alert) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (alert.status === "resolved" || alert.status === "false_alarm") {
    return NextResponse.json({ error: "closed_alert" }, { status: 409 });
  }

  const [{ data: memberships, error: membershipsError }, { data: targets, error: targetsError }] = await Promise.all([
    db.from("organisation_memberships")
      .select("organisation_id,branch_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .in("role", ["responder", "dispatcher"]),
    db.from("alert_dispatch_targets")
      .select("organisation_id,branch_id")
      .eq("alert_id", input.data.alertId)
      .in("status", ["pending", "accepted", "escalated"]),
  ]);
  if (membershipsError || targetsError) {
    console.error("Responder alert dismissal access check failed", membershipsError ?? targetsError);
    return NextResponse.json({ error: "dismissal_unavailable" }, { status: 500 });
  }
  const authorized = (targets ?? []).some((target) =>
    (memberships ?? []).some((membership) =>
      membership.organisation_id === target.organisation_id
      && (target.branch_id === null || membership.branch_id === null || membership.branch_id === target.branch_id),
    ),
  );
  if (!authorized) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error: dismissalError } = await db.from("responder_alert_dismissals").upsert({
    alert_id: input.data.alertId,
    user_id: userId,
    dismissed_at: new Date().toISOString(),
  }, { onConflict: "alert_id,user_id" });
  if (dismissalError) {
    console.error("Responder alert could not be removed from the active queue", dismissalError);
    return NextResponse.json({ error: "dismissal_unavailable" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, alertId: input.data.alertId });
}
