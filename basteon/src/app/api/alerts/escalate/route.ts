import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";

function cronAuthorized(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return Boolean(process.env.CRON_SECRET && bearer && bearer === process.env.CRON_SECRET);
}

async function runEscalationSweep() {
  const db = createAdminClient();
  const { data: pendingAlerts, error } = await db
    .from("alerts")
    .select("id,triggered_at,routed_at,status")
    .eq("status", "new")
    .eq("routing_status", "routed")
    .order("triggered_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  let escalated = 0;
  let checked = 0;
  for (const alert of pendingAlerts ?? []) {
    const { data: targets } = await db
      .from("alert_dispatch_targets")
      .select("id,organisation_id,branch_id,status,tier")
      .eq("alert_id", alert.id)
      .in("status", ["pending", "accepted"])
      .order("tier", { ascending: true });
    if (!targets?.length) continue;
    checked += 1;

    const policyOrgIds = [...new Set(targets.map((target) => target.organisation_id))];
    const { data: policies } = await db
      .from("organisation_dispatch_policies")
      .select("organisation_id,acknowledge_timeout_seconds")
      .in("organisation_id", policyOrgIds);
    const timeoutSeconds = Math.min(...targets.map((target) => {
      const policy = (policies ?? []).find((row) => row.organisation_id === target.organisation_id);
      return policy?.acknowledge_timeout_seconds ?? 45;
    }));
    const ageMs = Date.now() - new Date((alert.routed_at ?? alert.triggered_at) as string).getTime();
    if (ageMs < timeoutSeconds * 1000) continue;

    await db.from("alert_dispatch_targets").update({ status: "escalated" }).in("id", targets.map((target) => target.id));
    await db.from("alert_routing_events").insert({
      alert_id: alert.id,
      stage: "escalation_timeout",
      details: {
        escalated_at: new Date().toISOString(),
        reason: "No acknowledgement before timeout window.",
        previous_targets: targets.map((target) => ({ organisation_id: target.organisation_id, branch_id: target.branch_id, tier: target.tier })),
      },
    });

    for (const target of targets) {
      const { data: supervisors } = await db
        .from("organisation_memberships")
        .select("user_id,role,branch_id")
        .eq("organisation_id", target.organisation_id)
        .eq("status", "active")
        .in("role", ["owner", "admin", "manager"])
        .or(target.branch_id ? `branch_id.is.null,branch_id.eq.${target.branch_id}` : "branch_id.is.null");
      for (const supervisor of supervisors ?? []) {
        await db.from("notifications").insert({
          user_id: supervisor.user_id,
          type: "system",
          title: "Escalation required",
          body: "An alert was not acknowledged in time and has been escalated.",
          href: "/responder",
          payload: { alertId: alert.id, escalation: true },
        });
        await sendPushNotificationsToUser(supervisor.user_id, {
          title: "Escalation required",
          body: "An alert was not acknowledged in time.",
          tag: `basteon-alert-escalation-${alert.id}`,
          url: "/responder",
        });
      }
    }
    escalated += 1;
  }

  return NextResponse.json({ checked, scanned: pendingAlerts?.length ?? 0, escalated });
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runEscalationSweep();
}

export async function POST(request: Request) {
  if (!process.env.ALERT_ESCALATION_SECRET || request.headers.get("x-alert-escalation-secret") !== process.env.ALERT_ESCALATION_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runEscalationSweep();
}
